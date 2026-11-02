# REN-COB-01 — Cuentas corrientes, cuotas, cobros parciales y deudas

**Estado:** Implementación Beta (API + UI + persistencia). **Fecha:** 2026-11-02. **Responsable de aprobación funcional:** gestor de Rendo.
**Documentos relacionados:** ADR-REN-COB-01 y plan de verificación en este mismo documento.

## 1. Problema y objetivo

\`alquileres.monto_total\`, \`monto_cobrado\`, \`monto_sena\` y \`estado_pago\` describen un estado inicial, no una cuenta corriente auditable. La tabla \`pagos\` existente registra compras de cupos SaaS; **no** registra alquileres. El dinero de \`monto_deposito\` es garantía y **no** ingreso por renta.

Crear un subledger contractual por gestor con cuotas, vencimientos y pagos que admita abonos parciales, mora por fecha, anulaciones auditables y una vista administrativa. Preservar los contratos existentes, la política de delegación y la separación multi-tenant.

## 2. Reglas confirmadas del MVP

1. **Cuota**: una obligación de pago de un único alquiler, con índice, período, fecha de vencimiento, monto y gestor de origen. Las cuotas se fijan como snapshot del total contratado. No se recalculan automáticamente ante futuros ajustes del contrato.
2. **Plan**: el gestor o delegado autorizado lo genera desde un alquiler existente. La acción es idempotente: repetirla no duplica cuotas. Si no coincide el plan actual con el contrato, bloquea y requiere una decisión administrativa futura (sin modificar movimientos existentes).
3. **Mensual**: un vencimiento por período calendario, desde el día local de inicio hasta antes de la fecha final; máximo 120 períodos. El importe total del contrato se reparte en centavos, ajustando la última cuota para evitar redondeos. El día de vencimiento pactado se obtiene de \`detalle_precio.dia_vencimiento\` si es válido; en otro caso, el día de inicio; el vencimiento nunca antecede al comienzo del período.
4. **Diaria/por hora**: una sola cuota por el total, con vencimiento en la fecha local de inicio.
5. **Pago inicial ya registrado**: \`alquileres.monto_cobrado\` se incorpora como un asiento de **apertura** distribuido sobre las primeras cuotas. No es una segunda cobranza ni un nuevo ingreso de caja; se preserva su fecha de origen desconocida y se identifica claramente. Nunca se incluye la garantía de depósito.
6. **Cobro adicional**: registra importe positivo, fecha real, medio, referencia opcional y usuario autenticado. No puede exceder el saldo de la cuota; el control se hace bajo bloqueo transaccional del alquiler. Montos en \`numeric(14,2)\`, sin floats monetarios. Los pagos se registran en la moneda contractual actualmente operada por Rendo (ARS).
7. **Anulación**: no se borra el pago; se marca el ingreso como anulado, con motivo y actor. El saldo se recalcula sin él. Los asientos de apertura no pueden anularse en el MVP. Un cobro y su anulación no modifican la garantía.
8. **Estado derivado**: \`pagada\` si saldo cero; \`parcial\` si tiene algún abono, saldo positivo y no venció; \`vencida\` si saldo positivo y la fecha actual local es posterior al vencimiento; \`pendiente\` en el resto. La mora no genera intereses ni recargos automáticos.
9. **Consistencia legado**: el total de los pagos vigentes, incluida la apertura, sincroniza \`alquileres.monto_cobrado\` y \`estado_pago\`; las escrituras directas de estos campos, del monto, modalidad y fechas quedan bloqueadas mientras exista un plan. El API de alquileres no puede sustituir el ledger.
10. **No confundir módulos**: \`public.pagos\` y \`facturacion-afip\` se mantienen sin cambios. No se ejecutan cargos a tarjetas, transferencias bancarias ni emisión fiscal automática. El registro es manual y auditable.
11. **Autorización**: gestor propietario ve/gestiona su cuenta. Delegados activos con permiso \`ver\` ven únicamente alquileres de sus unidades/grupos autorizados; con \`gestionar\` pueden registrar cuotas y cobros solo dentro de su alcance. Delegaciones revocadas y otros gestores no acceden. RLS en PostgreSQL **y** comprobación en API. Las funciones de escritura usan identidad \`auth.uid()\` y no aceptan \`gestor_id\` del cliente.
12. **Seguridad**: cada mutación se realiza en una transacción PostgreSQL con bloqueo de la fila de alquiler; tablas de cuotas y cobros son de solo lectura por Data API autenticada, las escrituras son RPCs específicamente permitidas. Sin credenciales elevadas en navegador ni llamadas a pagos externos.

## 3. Modelo técnico (SDD)

- \`public.cobranza_cuotas\`: \`id, gestor_id, alquiler_id, numero, periodo_inicio, vencimiento, monto, created_at\`. FK de alquiler, índice único \`(alquiler_id, numero)\`. Sin eliminación física por API.
- \`public.cobranza_pagos\`: \`id, gestor_id, alquiler_id, cuota_id, importe, tipo ('apertura'|'cobro'), medio, fecha_pago, referencia, registrado_por, created_at, anulado_at, anulado_por, motivo_anulacion\`. FK de cuota, estado de anulación irrevocable.
- RLS: \`can_read_unidad\` por alquiler para \`SELECT\`, \`can_manage_unidad\` para RPC de generación/cobro/anulación. Las escrituras directas están revocadas a \`authenticated\`.
- RPC \`cobranzas_generar_plan(uuid)\` y \`cobranzas_registrar_pago(uuid,numeric,date,text,text)\`, \`cobranzas_anular_pago(uuid,text)\`; retornan IDs y deben comprobar \`auth.uid()\`.
- NestJS \`/cobranzas\`: \`GET\` (cuotas + saldos + pagos, filtrados por RLS), \`POST /alquileres/:id/generar\`, \`POST /cuotas/:id/pagos\`, \`POST /pagos/:id/anular\`. Los endpoints usan \`SupabaseAuthGuard\`.
- Next.js \`/[locale]/cobranzas\`: tablero con deuda, recaudación conciliable, cuotas pendientes/vencidas, plan por alquiler y movimientos de cada cuota. \`Sidebar\` lo vincula sin usar la sección de facturación SaaS.

## 4. UX y criterios de aceptación

- La sección se denomina «Cobros y deudas», accesible en el panel del gestor.
- No muestra como ingresos las garantías pactadas ni confunde señas cobradas al alta con pagos nuevos.
- La generación de plan muestra solo contratos al alcance del usuario y pide una acción explícita; nunca altera contratos existentes por cargar la página.
- En cada cuota aparecen vencimiento, contratado, pagado, saldo, estado y los movimientos identificados (apertura/cobro/anulado).
- Los controles de cobro/anulación no aparecen en delegados de solo lectura. Los bloqueos son reales en RLS y API, no solo en botones.
- Errores 400/403/404/409 muestran mensajes legibles sin registrar pagos parciales a mitad de una transacción.
- Se mantiene el estado existente de los dos alquileres beta; una migración de esquema **no genera planes ni cobros** por sí sola.

## 5. Verificación (TDD y seguridad)

- Prueba de escenario con propietario, delegado \`gestionar\`, delegado \`ver\`, delegado ajeno y delegación revocada.
- Generar dos veces el mismo plan → mismo total y número de cuotas, cero duplicados.
- Cuota con abonos de $120.000 y $180.000 sobre $300.000 → pagada; pago de $180.001 tras el primero → rechazo por sobrepago.
- Una anulación restaura el saldo, mantiene registro, actor y motivo; anular apertura o anular dos veces falla.
- Fecha vencida se deriva de la fecha local de Argentina, no del huso UTC del servidor.
- Plan para contrato con cobro inicial → apertura identificada y ningún doble ingreso de caja.
- Contrato de otro gestor, unidad fuera del alcance y delegado de solo lectura → RPC de escritura rechazada.
- Revisión de compilación TypeScript y UI Vercel **sin GitHub Actions**.
- Límite: este MVP no trae conciliación bancaria real, intereses, AFIP, cobro automático, edición de cuotas ya emitidas ni redeterminación por índices.

## 6. Futuras fases

1. Historial financiero de inquilino con reactivación segura de identidades archivadas.
2. Exportaciones XLSX/CSV/PDF, envío de recibos y recordatorios opt-in.
3. Prorrateos/ajustes legales configurables, multimoneda, intereses y refinanciaciones con asientos compensatorios.
4. Conciliación con movimientos bancarios/PSP, reversos verificados y auditoría fiscal.
