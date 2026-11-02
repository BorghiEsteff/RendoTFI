# ADR-REN-COB-01: subledger contractual separado de pagos SaaS

**Fecha:** 2026-11-02  
**Estado:** Adoptada para MVP Beta, sujeta a verificación de código y escenarios adversariales.

## Contexto
Rendo tiene `public.pagos` para adquirir cupos SaaS y campos agregados de estado inicial en `public.alquileres`. Reutilizar la tabla SaaS o tratar el depósito como ingreso deformaría la contabilidad operativa.

## Decisión
Introducir `cobranza_cuotas` y `cobranza_pagos` con relaciones a contrato/gestor, vistas de saldo calculado y RPCs transaccionales. El registro del pago es inmutable excepto anulación con actor y motivo; los montos iniciales ya declarados se incorporan como movimientos de apertura (no ingreso nuevo). Los movimientos ordinarios actualizan las columnas legacy del alquiler para preservar pantallas anteriores. La generación de plan es manual, explícita e idempotente.

### Opciones descartadas
- Reusar `public.pagos`: mezcla alquiler con pagos de membresía y cupos.
- Guardar una cadena JSON de pagos en `alquileres`: impide reconciliación, índices y auditoría concurrente.
- Crear cuotas automáticas mediante tareas programadas sin control: podría modificar contratos existentes de forma inesperada.
- Aceptar escrituras directas del frontend a cuotas: riesgo de manipulación de importe, gestor o anulación.
- Considerar garantía recibida como renta cobrada: confunde custodia con caja operativa.

### Seguridad y consistencia
El frontend no envía `gestor_id` ni `registrado_por`. El servidor usa JWT de usuario y NestJS comprueba permisos; PostgreSQL vuelve a comprobar `auth.uid()` y `can_manage_unidad`. La fila de alquiler se bloquea antes de registrar/anular un pago para impedir sobrecobro por operaciones simultáneas. RLS protege lectura; revocaciones de privilegios impiden mutaciones directas de tablas.

### Riesgos / decisiones pendientes
- Los importes de apertura de contratos anteriores no contienen una fecha de cobro fiable: no deben sumarse como ingresos nuevos del mes.
- El producto todavía no reconcilia bancos, PSP, comprobantes fiscales ni garantías. Necesitan módulos separados.
- La eliminación/cancelación de un alquiler con cuotas emitidas queda restringida; un posterior módulo de rescisión deberá efectuar contrapartidas explícitas antes de cancelar.
- Un contrato mensual pactado en total se divide en períodos calendarios; no se realizan aumentos automáticos.
- Deben probarse los límites y paginación para clientes con muchas unidades antes de escalar; el primer panel limita la consulta.
