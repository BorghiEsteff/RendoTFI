# REN-DISP-01 — Auditoría y primera mejora de disponibilidad (2026-11-02)

**Alcance**: analizar el comportamiento actual y corregir la visibilidad de ocupaciones sin cambiar las reglas de negocios ni los contratos. **Estado**: implementación Beta; aceptación E2E pendiente. **Referencia original**: specs/003-modality-aware-availability.

## Hallazgos comprobados

| Hallazgo | Evidencia | Riesgo |
|---|---|---|
| El solapamiento de alquileres está protegido de verdad | PostgreSQL tiene \`exclude_alquileres_intervalo_overlap\`: GiST sobre unidad y \`tstzrange(inicio_at,fin_at,'[)')\` para alquileres no cancelados ni eliminados. Prueba transaccional de choque PASS. | Correcto para alquileres registrados. |
| API ya comprobaba antes de guardar | \`AlquileresService.checkOverlap\` itera alquileres de una unidad. La DB es autoridad ante carreras. | Antes no devolvía HTTP 409 para error SQL \`23P01\`; corregido. |
| Formulario no comunicaba fechas ocupadas | Wizard por hora/día/mes pedía fechas, pero no consultaba disponibilidad previa. | Confusión y validación tardía. |
| Marketplace mostraba publicados sin calendario | Estado de publicación ≠ ocupación; una unidad publicada puede tener intervalos ocupados. | Usuarios podrían interpretar publicado como siempre disponible. |
| Especificación 003 parcialmente implementada | No hay tablas \`bloqueos_disponibilidad\`, \`configuraciones_disponibilidad_unidad\` ni \`configuraciones_disponibilidad_grupo\`. | No existen horarios, buffer, mantenimiento ni revisión explícita. |
| Política de seña contradictoria | Especificación 003: bloquear solo cuando la seña opcional fue cobrada. Implementación actual: **todos** los alquileres no cancelados bloquean, con o sin seña. | **No cambiar sin decisión de negocio**, porque liberar contratos existentes podría permitir sobreventa. |

## Cambios implementados en REN-DISP-01

1. \`public.disponibilidad_proyeccion(unidad, desde, hasta)\`: consulta de ocupaciones derivada exactamente de los intervalos de alquiler. Solo devuelve intervalos, estado de publicación y estado "reglas_operativas=no_configuradas"; **jamás** devuelve identificadores de alquiler, nombre del inquilino, valores, contactos, notas ni IDs de otros gestores.
2. SQL SECURITY DEFINER con búsqueda calificada y ejecutabilidad acotada. Las unidades publicadas son consultables anónimamente; las no publicadas solo dentro del alcance \`can_read_unidad\`. Ventana máxima 730 días; más de 1000 resultados se marca truncado.
3. API pública \`GET /marketplace/unidades/:id/disponibilidad\` (sin datos privados) y API operativa autenticada \`GET /unidades/:id/disponibilidad\` (permiso por gestor/delegado). \`desde/hasta\` ISO opcionales, por defecto próximos 60 días.
4. Ficha pública: calendario de 60 días. Día marcado significa **alguna** ocupación (posiblemente solo algunas horas). Día no marcado significa **sin ocupación registrada**, nunca "disponible". Reintento ante error, sin datos de prueba.
5. Wizard de alquiler: consulta previa de la unidad/intervalo exactos por hora, día o mes. Advierte cruces y fallos de servicio, pero la DB sigue validando definitivamente al persistir.
6. La API transforma \`23P01\` (exclusión por solapamiento) a HTTP **409 Conflicto** en create/update y ofrece mensaje legible, también en carreras concurrentes.

## Verificación

- SQL Beta: GiST de exclusión existe y rechaza superposición (transacción revertida).
- SQL Beta: rol \`anon\` obtiene solo períodos de unidad publicada y no ve unidad pausada; gestor sí puede consultar su unidad pausada.
- SQL Beta: delegado sin alcance no ve unidad pausada privada; unidades publicadas pueden ser consultadas por todos (como el marketplace).
- Las pruebas de código \`apps/api/src/common/disponibilidad.spec.ts\` están escritas. **Vitest NO ejecutado**.
- Validación navegador con sesión real, capturas escritorio/móvil, E2E y carga concurrente HTTP: **PENDIENTE**.
- Ninguna operación de prueba persistió cambios en alquileres, unidades ni pagos.

## Decisiones pendientes antes de la implementación completa de specs/003

- **D1 Bloqueo de contratos**: ¿todo alquiler registrado debe bloquear desde su alta, o solo al cobrar la seña o confirmar una reserva? Si se adopta lo segundo, hay que introducir \`estado_reserva\`, transiciones auditables y backfill explícito, sin interpretar \`monto_sena\` como confirmación.
- **D2 Bloqueos manuales**: mantenimiento, limpieza, uso privado; definir quién puede crear/liberar y motivos, y si impiden nuevas reservas de forma global.
- **D3 Horarios y buffers**: calendario semanal de unidades por hora, minutos entre turnos, herencia de grupo y zonas horarias. Cambios de configuración deben validar futuras reservas antes de activarse.
- **D4 Calendario avanzado**: navegación entre meses, detalle por intervalos horarios y leyenda de estado/publicación; advertir disponibilidad parcial y reintentos ante fallos.
- **D5 Alcances por modalidad**: mínimos de \`cantidad_tiempo\`, check-in/out, tolerancias, bloqueos de unidades por hora y meses de 28/29/30/31 días.
- **D6 Integración operativa**: bloquear creación si la unidad está manualmente cerrada, sin confundir pausado de marketplace con libre, y mantener los mismos resultados en público y administración.

**Regla de seguridad**: nunca deducir libertad por ausencia de registros hasta implementar y aprobar configuración operativa + revisión histórica. No se cambiaron \`Unidad.estado\`, las reservas ni los dos contratos Beta. No utilizar GitHub Actions.
