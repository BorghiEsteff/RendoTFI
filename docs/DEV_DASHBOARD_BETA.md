# RENDO OPS — Consola de desarrollo (beta)

Estado: dashboard de beta desplegado. Acceso de superadmin pendiente de registro/verificación del correo autorizado.

## Módulos
- /es/dev/metricas: contadores reales y tiempo de consulta a la base.
- /es/dev/moderacion: unidades en revisión con restauración/suspensión atómica y auditada.
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

## Despliegue y verificaciones pendientes
- Migraciones: `20261111220000_dev_console_beta.sql`, `20261111223000_dev_invite_claim_on_verification.sql`, `20261111224500_dev_invite_email_change_hardening.sql`, `20261111232500_single_dev_superadmin.sql`.
- Backend y frontend deben corresponder al mismo commit.
- Beta web debe enviar /api/dev/* a la API beta con la reescritura existente.
- Verificar 401 sin token, 403 con usuario normal, 200 con dev.
- Verificar que pagos repetidos no acreditan cupo dos veces; MP no está incluido en pagos manuales.
- Revisar build, pruebas de API/web y preview antes de liberar beta pública.
- No crear GitHub Actions.

## Limitaciones explícitas
- Transferencias no cuentan con flujo de ingreso en la API actual; la auditoría implementada admite efectivo.
- Los indicadores son métricas básicas del dominio, no estadísticas p95 ni telemetría del runtime.
