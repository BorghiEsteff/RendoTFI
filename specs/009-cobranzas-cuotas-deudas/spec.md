# 009 — Cobros, cuotas y deudas | Especificación funcional

**Fecha**: 2026-11-02  
**Estado**: Implementación Beta; aceptación pendiente de sesión real en navegador.  
**Decisión**: REN-COB-01. **SDD/TDD**: \`docs/architecture/REN-COB-01-sdd-tdd-spec.md\`.

## Historias de usuario
- US1: Como gestor, quiero generar un plan de cobros desde un alquiler ya registrado para no repetir manualmente el importe y período.
- US2: Como gestor/delegado autorizado, quiero ver vencimientos, cobros realizados y deudas por cuota para administrar la cobranza.
- US3: Como gestor/delegado con Gestionar, quiero registrar un pago parcial de una cuota, seleccionando importe, fecha y medio.
- US4: Como administrador autorizado, quiero anular por error un cobro dejando una evidencia permanente del movimiento y su motivo.
- US5: Como delegado de solo lectura, quiero consultar exclusivamente alquileres de mis unidades autorizadas sin poder registrar ni anular cobros.
- US6: Como gestor de otra cuenta, no debo poder leer ni alterar cuotas y cobros ajenos.

## Criterios de aceptación
- Generar dos veces un plan produce la misma cantidad y suma, sin duplicados.
- Mensual: una cuota por período calendario (máximo 120); diaria y por hora: una cuota única.
- Cuotas repartidas en centavos exactos; vencimiento en fecha local Argentina.
- Seña/cobro inicial registrado previamente se importa una sola vez como apertura, sin nuevas entradas de caja.
- Pagos positivos con máximo dos decimales, no futuros, nunca superiores al saldo. Evitar carreras concurrentes con bloqueo de la fila de alquiler.
- Anulación motivada (8-500 caracteres), reversible solo por asiento de negocio: el pago original permanece.
- Estado derivado: pendiente/parcial/vencida/pagada; vencida se define por fecha y saldo positivo.
- Separar depósito/garantía, facturación AFIP y pago SaaS de este ledger.
- RLS + permiso API por unidad y rol. Sin permisos por cuerpo JSON manipulable.
- Cualquier error de carga se muestra como error, nunca como «0 cobros» afirmado.

## Fuera de alcance (propuesta posterior)
Conciliación bancaria, cobro automático, multas/intereses, fiscalización, recibos PDF oficiales, ajustes indexados automáticos, multimoneda y fraccionamiento de cuotas previamente emitidas.

## Riesgos residuales
Sin sesión auténtica de navegador validada; los tests unitarios de Vitest se escribieron pero deben ejecutarse localmente o mediante otro runner autorizado sin GitHub Actions. La consulta inicial limita a 500 cuotas; el agregado se etiqueta como correspondiente a las cuotas cargadas. No confundir los cobros de apertura con ingresos nuevos del período.
