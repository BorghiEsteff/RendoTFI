# Rendo Beta — limpieza de directorios y compartición por gestor (2026-11-02)

## Alcance autorizado
El usuario pidió vaciar los inquilinos registrados y convertir el directorio en una lista compartida entre un gestor y sus delegados activos, con aislamiento frente a terceros.

## Operación de datos (beta Supabase)
- Antes: 4 inquilinos activos, 2 vinculados a alquileres existentes, 2 sin alquiler.
- Operación transaccional con preflight exacto: eliminación física de los 2 no vinculados; baja lógica (`deleted_at`) de los 2 vinculados.
- Después: **0 inquilinos activos; 2 históricos archivados; 2 alquileres activos sin cambios**.
- No se borraron contratos, alquileres, documentos ni cobros. Los DNI de fichas archivadas permanecen reservados por la unicidad global. No reproducir este DML como una migración automática en otros entornos.

## Política de seguridad
- Un inquilino activo pertenece a `inquilinos.gestor_id`, no al usuario que lo creó.
- Gestor propietario: lectura y gestión del directorio.
- Delegado **activo** del mismo gestor: lectura compartida (permisos `ver` o `gestionar`).
- Delegado activo con `gestionar`: también puede editar inquilinos compartidos; su alcance sobre unidades/alquileres sigue independiente.
- Solo el gestor puede dar de baja inquilinos. Trigger defiende frente a modificaciones directas de `gestor_id`, `id`, `creado_por` o `deleted_at` por un delegado.
- Otras cuentas gestoras, delegados ajenos y delegaciones revocadas no pueden consultar ni modificar las fichas.
- Un inquilino archivado no aparece en el directorio, pero puede leerse dentro de un alquiler histórico cuyo acceso está autorizado.

## Comprobaciones sobre PostgreSQL real (todas revertidas cuando usaban datos sintéticos)
- Gestor y delegado activo leen la misma ficha sintética.
- Delegado con `gestionar` edita la ficha compartida creada por el gestor.
- Gestor de otro workspace no ve la ficha.
- `ver` conserva consulta pero no autoriza edición; delegación revocada no ve registros.
- Delegado no puede hacer baja lógica directa; propietario sí.
- La ficha archivada sigue visible en una consulta de historial del alquiler del gestor.
- Sin invocar GitHub Actions.

## Código relacionado
- `apps/api/src/authorization/authorization.service.ts`: misma política del directorio.
- `apps/api/src/inquilinos/inquilinos.service.ts`: filtra workspace antes de paginar.
- `apps/api/src/inquilinos/inquilinos.controller.ts`: no recorta listados después del paginado.
- `apps/web/src/app/[locale]/(gestor)/inquilinos/page.tsx`: directorio compartido y DNI correcto.
- `supabase/migrations/20261102211500_tenant_directory_workspace_shared.sql`: funciones RLS y trigger.
