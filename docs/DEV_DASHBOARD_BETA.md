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

## Alta de un usuario de desarrollo
1. En la base de beta, crear o invitar a un correo que controle el propietario mediante Supabase Auth > Users. No editar auth.users por SQL.
2. Verificar el correo, iniciar sesión y ejecutar esta concesión en el SQL Editor, sustituyendo el email:

    INSERT INTO public.rendo_dev_access(user_id,role,enabled)
    SELECT id,'dev',true FROM auth.users
    WHERE lower(email)=lower('REEMPLAZAR_POR_CORREO_REAL')
      AND email_confirmed_at IS NOT NULL
    ON CONFLICT (user_id) DO UPDATE
    SET role=excluded.role, enabled=true, updated_at=now();

3. Confirmar 1 fila afectada. No asignar permisos a una cuenta distinta sin aprobación.
4. Para revocar, establecer enabled=false en rendo_dev_access por user_id.

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
