# RENDO OPS — Consola de desarrollo (beta)

Estado: preparada en rama; no marcar como desplegada hasta verificar ambos servicios.

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
- La consola está bloqueada por defecto. Exige RENDO_BETA_MODE=true y RENDO_DEV_DASHBOARD_ENABLED=true en ambos despliegues.
- Toda falla de conexión se presenta como error, no como métricas simuladas.

## Alta de cuenta devtest@gmail.com (beta)

La dirección de desarrollador ya está reservada mediante la tabla privada rendo_dev_invitations con validez de 14 días. No existe todavía el usuario en Supabase Auth y no se ha creado una contraseña.

1. El titular del correo abre https://rendo-beta-web.vercel.app/es/auth/registro y elige correo electrónico. Introduce devtest@gmail.com y una contraseña privada, que nunca debe enviarse por chat.
2. Confirma el mensaje enviado por Supabase Auth a ese correo.
3. Un trigger limitado a auth.users, al confirmar el correo, consume la invitación y concede role=dev en rendo_dev_access. La autorización no procede de user_metadata.
4. Inicia sesión en /es/auth/login y abre /es/dev. Debe ver métricas reales.
5. Ante pérdida o cambio de correo, el trigger deshabilita el acceso; también puede revocarse en la tabla rendo_dev_access estableciendo enabled=false.

Nunca insertar usuarios directamente en auth.users, crear contraseñas predeterminadas ni publicar service_role.

## Despliegue y verificaciones pendientes
- Migración: supabase/migrations/20261111220000_dev_console_beta.sql.
- Backend y frontend deben corresponder al mismo commit.
- Beta web debe enviar /api/dev/* a la API beta con la reescritura existente.
- Verificar 401 sin token, 403 con usuario normal, 200 con dev.
- Verificar que pagos repetidos no acreditan cupo dos veces; MP no está incluido en pagos manuales.
- Revisar build, pruebas de API/web y preview antes de liberar beta pública.
- No crear GitHub Actions.

## Limitaciones explícitas
- Transferencias no cuentan con flujo de ingreso en la API actual; la auditoría implementada admite efectivo.
- Los indicadores son métricas básicas del dominio, no estadísticas p95 ni telemetría del runtime.
