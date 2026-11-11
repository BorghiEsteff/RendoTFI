# RENDO OPS — Consola de desarrollo (beta)

Estado: dashboard de beta desplegado. Acceso de superadmin pendiente de registro/verificación del correo autorizado.

## Módulos
- /es/dev/metricas: contadores reales y tiempo de consulta a la base.
- /es/dev/moderacion: **todas** las publicaciones no eliminadas, paginadas (25 por página), con filtro de estado, opción «con reportes» desde la primera denuncia y búsqueda por título. Consultar motivos de reportes e historial de acciones del superadmin. Acciones manuales: enviar a revisión, suspender, restaurar de forma transaccional y auditada.
- /es/dev/auditoria-pagos: solo pagos en efectivo pendientes; aprobación/rechazo y cambio de cupo transaccional.
- /es/dev/logs: últimos 200 registros auditados, con filtro local.

## Seguridad
- No se usa user_metadata para autorización (es editable por el usuario).
- La API valida cada token con Supabase Auth y consulta rendo_dev_access con cliente exclusivamente servidor.
- rendo_dev_access tiene RLS; anon y authenticated carecen de privilegios sobre ella.
- Los RPC de revisión solo tienen EXECUTE para service_role.
- La consola exige RENDO_BETA_MODE=true y RENDO_DEV_DASHBOARD_ENABLED=true en ambos despliegues y rechaza todas las cuentas salvo el superadmin verificado.
- Toda falla de conexión se presenta como error, no como métricas simuladas.

## Cuenta única: devtest@gmail.com (superadmin beta)

Solo `devtest@gmail.com` puede acceder a la consola como superadmin. Internamente el rol es `dev`. La base de datos impide activar una segunda cuenta privilegiada, agregar otra invitación o usar el rol `admin` paralelo. La API vuelve a comprobar el correo y el rol en cada petición.

La invitación de esta dirección ya está reservada en la tabla privada `rendo_dev_invitations`. No existe todavía el usuario en Supabase Auth ni se creó una contraseña.

1. El titular del correo abre https://rendo-beta-web.vercel.app/es/auth/registro y elige correo electrónico. Introduce devtest@gmail.com y una contraseña privada, que nunca debe enviarse por chat.
2. Confirma el mensaje enviado por Supabase Auth a ese correo.
3. Un trigger limitado a auth.users, al confirmar el correo, consume la invitación y concede role=dev en rendo_dev_access. La autorización no procede de user_metadata.
4. Inicia sesión en /es/auth/login y abre /es/dev. Debe ver métricas reales.
5. Ante pérdida o cambio de correo, el trigger deshabilita el acceso; también puede revocarse en la tabla rendo_dev_access estableciendo enabled=false.

Nunca insertar usuarios directamente en auth.users, crear contraseñas predeterminadas ni publicar service_role.

## Reglas de moderación para beta

- «Con al menos un reporte» consulta cualquier unidad con `reportes_count > 0`, sin exigir 50 denuncias. El umbral automático preexistente de 50 sigue funcionando en paralelo; no se baja de forma indiscriminada para evitar retiradas abusivas por una sola denuncia.
- `revisar`: de `publicada`, `pausada` o `no_disponible` a `en_revision`.
- `suspender`: de `publicada`, `pausada`, `no_disponible` o `en_revision` a `suspendida`.
- `restaurar`: desde `en_revision` o `suspendida` al estado anterior si una acción manual guardó su origen; para las revisiones automáticas antiguas sin origen, a `publicada`.
- Borradores, archivadas y bloqueadas por impago se pueden inspeccionar pero no alterar desde la consola; evita que un superadmin publique borradores o eluda bloqueos de pago accidentalmente.
- Los reportes exponen motivo y fecha, no el identificador del denunciante. El historial muestra las decisiones administrativas con estados anterior y nuevo.
- `rendo_dev_review_moderation` valida nuevamente la identidad única del superadmin y la transición permitida; la RPC es exclusiva para `service_role`.
- `rendo_dev_moderation_origin` almacena el último estado legítimo para restauración segura, con RLS activo y sin acceso de `anon` ni `authenticated`.

## QA ejecutado

- Migración `20261112001000_rendo_ops_moderation_all.sql` aplicada a Supabase beta.
- Se probó la RPC utilizando el rol PostgreSQL real `service_role` (no solo `postgres`). Se corrigió el acceso a `auth.users` que ese rol no tiene; ahora la RPC verifica la concesión única en `rendo_dev_access`, cuya identidad valida el trigger y el backend. El rol `authenticated` no puede ejecutar la RPC.
- Prueba transaccional con publicación sintética y rollback intencional: `revisar → suspender → restaurar publicada` y `pausada → suspender → restaurar pausada`, 5 auditorías generadas y luego revertidas, borrador protegido. Se confirmó ausencia de filas y logs de prueba persistentes.
- Se verificó adicionalmente bajo `SET LOCAL ROLE service_role`: revisar → suspender → restaurar y 3 entradas auditadas, todo revertido. Resultado: 0 filas sintéticas y 0 auditorías de prueba persistidas.
- Queda pendiente el recorrido manual autenticado en navegador del superadmin para validar los controles web al desplegar.

## Despliegue y verificaciones pendientes
- Migraciones: `20261111220000_dev_console_beta.sql`, `20261111223000_dev_invite_claim_on_verification.sql`, `20261111224500_dev_invite_email_change_hardening.sql`, `20261111232500_single_dev_superadmin.sql`.
- Backend y frontend deben corresponder al mismo commit.
- Beta web debe enviar /api/dev/* a la API beta con la reescritura existente.
- Verificar 401 sin token, 403 con usuario normal, 200 con dev. Comprobar nuevos filtros, paginación y el detalle de reportes.
- Verificar que pagos repetidos no acreditan cupo dos veces; MP no está incluido en pagos manuales.
- Revisar build, pruebas de API/web y preview antes de liberar beta pública.
- No crear GitHub Actions.

## Limitaciones explícitas
- Transferencias no cuentan con flujo de ingreso en la API actual; la auditoría implementada admite efectivo.
- Los indicadores son métricas básicas del dominio, no estadísticas p95 ni telemetría del runtime.
