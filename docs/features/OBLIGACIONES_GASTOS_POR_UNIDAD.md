# Rendo — Gastos y obligaciones por unidad (MVP)

**Estado:** Implementado en rama aislada. Migración SQL pendiente de ejecutar en entorno de QA. Sin despliegue público.

## Alcance

Un Gestor puede controlar por unidad obligaciones privadas y manuales: expensas, impuesto inmobiliario, tasa municipal, luz, agua, gas, mantenimiento y otros conceptos. Es independiente de los cobros de alquiler.

- Frecuencia mensual, bimestral, anual o única, con período de inicio.
- Vencimiento en día 1..28, importe estimado opcional, moneda ARS/UYU/USD, responsable y notas.
- Período seleccionado AAAA-MM: pendiente o pagado, importe real opcional y fecha/autor del registro.
- Historial conservado; archivo lógico de conceptos sin eliminación de períodos.
- Resumen en grilla y tabla de Mis unidades.
- Estado «Al día» SOLO según lo registrado por el usuario; sin integración con proveedores.
- Obligaciones vencidas de meses anteriores siguen afectando el resumen aun si se pagó el mes actual.
- Ninguna obligación afecta publicación, moderación, alquileres ni pagos de Rendo.
- Alta, edición, archivo, pago y reapertura visibles en Registro de Actividad.

## API

Todas las rutas usan SupabaseAuthGuard, JWT, DTO validados y AuthorizationService. Propietario y unidad se resuelven y verifican en servidor, nunca desde payload del usuario.

| Método | Ruta | Capacidad |
| --- | --- | --- |
| GET | /unidades/obligaciones/resumen?ids=UUID,...&periodo=AAAA-MM | Solo unidades del alcance, máximo 100 |
| GET | /unidades/:unidadId/obligaciones?periodo=AAAA-MM | canReadUnidad |
| POST | /unidades/:unidadId/obligaciones | canManageUnidad |
| PATCH | /unidades/:unidadId/obligaciones/:obligacionId | canManageUnidad |
| POST | /unidades/:unidadId/obligaciones/:obligacionId/periodos | canManageUnidad y período válido |

## Migración requerida

Archivo: supabase/migrations/20261117204000_unidad_obligaciones_gastos.sql.

Crea unidad_obligaciones y unidad_obligacion_periodos, índices, claves compuestas, triggers de validación y auditoría, RLS por unidad y GRANT mínimos. No expone gastos al marketplace ni a anon. No permite DELETE. No inserta datos de prueba ni cambia roles, publicaciones o alquileres.

**No aplicar en Supabase público para probar.** Usar base local aislada o rama de base de datos autorizada. Las ramas de Supabase pueden generar cargos; no suponer que son gratis.

## Pruebas

- pnpm --filter api test:expenses (8 pruebas de períodos y 4 de autorización)
- pnpm --filter api build (ejecuta test:audit y test:expenses)
- pnpm --filter web build
- supabase/tests/013_unidad_obligaciones_esquema.sql (12 assertions pgTAP de esquema y RLS, ejecutar solo después de migración en QA).

### Casos de integración que requieren base aislada

1. Gestor agrega expensas en una unidad. Sin configurar -> Pendiente -> Vencido cuando corresponda.
2. Pagar período actual -> Al día si no hay deudas.
3. Mes siguiente no hereda pago anterior; mes actual pagado no oculta deuda previa.
4. Delegado con permiso gestionar dentro de alcance crea y marca; delegado solo lectura no.
5. Unidad ajena retorna 404; anon no consulta obligaciones ni pagos.
6. Archivar conserva historial; no se permite eliminar pagos.
7. Registrar y deshacer pago aparece en historial de auditoría del Gestor.
8. Validar accesibilidad responsive y flujo en móvil y escritorio.

## Activación segura

1. Revisar el PR, compilaciones y pruebas.
2. Respaldar QA, aplicar migración únicamente en base aislada.
3. Ejecutar pgTAP y escenarios reales.
4. Conectar previews de web/API a la misma base aislada y probar E2E.
5. Con autorización expresa, aplicar migración pública y publicar web y API coordinadamente.

NO fusionar ni desplegar automáticamente esta rama. Una preview que apunta al Supabase público sin migración no es funcional: devolverá error de tabla inexistente, no debe usarse para E2E.
