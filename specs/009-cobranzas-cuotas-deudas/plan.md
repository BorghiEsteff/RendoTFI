# 009 — Plan de implementación

## Decisiones arquitectónicas
Consultar \`docs/architecture/ADR-REN-COB-01-contractual-ledger.md\`.

## Fase A — Datos
Tabla \`cobranza_cuotas\`, \`cobranza_pagos\`; políticas RLS; 3 RPCs; trigger de integridad para impedir edición directa del estado financiero del contrato con plan. Migración aditiva, sin backfill de cuotas.

## Fase B — API
NestJS \`CobranzasModule\`, controlador autenticado y servicio con DTO validados. Paginación/permiso; contabilidad de saldos según pagos no anulados; sincronización del estado legado mediante RPC.

## Fase C — Web
Ruta \`/[locale]/cobranzas\`, enlace en Sidebar, panel con resúmenes del listado, estados, plan por alquiler, pagos y anulaciones. Delegado con \`ver\` opera solo lectura.

## Fase D — Verificación y lanzamiento
SQL real en \`BEGIN...ROLLBACK\`, casos propietario/delegado/outside, redondeos, historial inicial, sobrepago, anulación, idempotencia. Compilaciones de API y web desde Vercel sin GitHub Actions. Validación real de sesiones/Playwright pendiente hasta ejecución.

## Invariantes
No alterar \`public.pagos\` (cupo SaaS), facturación fiscal, depósito en custodia, DNI ni lista de inquilinos. Planes existentes no se modifican implícitamente.
