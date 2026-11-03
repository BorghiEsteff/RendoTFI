# ADR-REN-DISP-02 — Bloqueo por alquiler registrado y aviso público de ocupación

**Fecha:** 2026-11-03  
**Estado:** DECISIÓN FUNCIONAL APROBADA por el propietario del producto; verificación web Beta pendiente de aceptación visual.

## Decisión D1

Un Alquiler registrado de cualquier modalidad bloquea inmediatamente su intervalo **[inicio_at, fin_at)** si no está cancelado ni eliminado lógicamente. No depende del cobro de la seña, pago parcial o depósito. El contrato registrado constituye compromiso operativo. Cancelar o archivar el alquiler puede liberar su intervalo según reglas de rescisión auditadas; cambios únicamente financieros jamás lo liberan. La autoridad final contra solapamientos es la exclusión GiST ya implementada.

El estado manual **Unidad.estado** es completamente independiente: publicar una unidad no implica que todas sus fechas estén libres; al alquilarla **se mantiene el aviso público**. No se cambia a "no disponible", "pausada" o "archivada" por tener alquileres activos.

## Comportamiento público

1. Si el instante de consulta está dentro de un período registrado, se muestra con claridad: **«Esta unidad se encuentra alquilada hasta el X»**, fecha y hora Argentina cuando sea relevante. Traducciones ES/PT/EN.
2. Si la ocupación vigente se prolonga por reservas consecutivas exactamente adyacentes (sin intervalo libre), el aviso muestra el final del tramo continuo, no una fecha intermedia.
3. Si solo hay una reserva futura, no se anuncia «alquilada actualmente». Los días con ocupación se muestran en el calendario, que no expone datos privados.
4. El mensaje desaparece al finalizar la ocupación. Se mantiene la ficha, precio comercial, contacto y visibilidad en búsquedas de unidades publicadas.
5. Los errores, resultados truncados o ausencia de reservas no certifican disponibilidad. El anuncio informa únicamente sobre alquileres registrados hasta que existan bloqueos manuales, buffers y horarios efectivos.

## Comparación de opciones

- **Elegida:** bloquear desde registrar alquiler; evita que una unidad quede ofrecida dos veces por un cobro pendiente. Compatible con la restricción PostgreSQL existente.
- **Descartada:** bloquear solo después de una Seña cobrada; deja expuestos contratos efectivos y duplica la noción de confirmación.
- **Descartada:** despublicar toda la Unidad mientras tenga una reserva; impide captar interés por otros períodos disponibles.

## Consideraciones técnicas

El aviso usa exclusivamente los intervalos anónimos de \`public.disponibilidad_proyeccion\`, no accede a inquilinos ni a documentos privados. Fechas y horas interpretadas con \`America/Argentina/Buenos_Aires\`. El texto evita afirmar "libre" sin reglas operativas configuradas. La presentación se actualiza periódicamente ante el cambio de hora; la persistencia sigue validándose en PostgreSQL al guardar alquileres.

## Verificación y pendientes

- Matriz de intervalos exactos: activo ahora, futuro solamente, período ya terminado, extremo de salida, alquiler horario, alquiler diario, múltiples alquileres consecutivos, lectura incompleta.
- SQL: confirmar exclusión incluso para alquiler sin Seña y que la Unidad publicada conserve su estado.
- UI E2E en escritorio/móvil y test automatizado en runner autorizado: pendiente si no hay evidencia real.
- No se crean ni modifican reservas para activar esta decisión. No ejecutar GitHub Actions.
