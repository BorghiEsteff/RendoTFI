# Rendo — estado operativo compacto

- Milestone actual: beta publicada, no cerrada; resolver observaciones con evidencia real.
- Feature actual: specs/008-beta-observaciones-2026-10-02; alcance y estados en issues.md.
- Coordinación vigente: GitHub; rama de handoff `codex/github-handoff-2026-10-19`. Entrada AGENTS.md y docs/GITHUB_WORKFLOW.md. El chat ChatGPT implementa; Codex opera la máquina, verifica y despliega; Carlos tiene autoridad final. Pi/Antigravity inactivos.
- Estado: N01 abierto; N02–N08 pendientes de aceptación integral. Servicio local recuperado (SHA256 8016ca91a43c68cb9a3ee543daaf2a41e2ef86ab4feebb5f5cf94ee67d579081); contiene WIP distinto del deployment B009. Subirlo no autoriza desplegarlo.
- Evidencia histórica B009/recuperación: `specs/008-beta-observaciones-2026-10-02/evidence/N01/`; límites de publicación en docs/GITHUB_SYNC.md.
- Marco vigente: constitución v3.0.0; Spec Kit conserva intención y trazabilidad. Revisión según riesgo con RESULT_PACKET compacto, sin repetir historial ni checks verdes con inputs vigentes.
- Autorización previa B010: una ejecución N01, hasta dos Gestores/un Delegado temporales y archivado propio; sin tocar testers ni purgar Auth. Sin ejecución acreditada.
- Riesgos: Las 3 unidades residuales del intento interrumpido previo permanecen en DB remota hasta la ejecución de la suite de archivado/limpieza autorizada.
- Disponibilidad #2 (2026-10-19 23:32 ART): front/live/ready y Auth 200; DNS A local/Google/Cloudflare correcto. NXDOMAIN anterior no se reproduce. Registro real no probado; sesión Vercel caducada impide acreditar IDs/SHA actuales. Evidencia: `evidence/N01/issue-002-availability.md` dentro de la feature.
- Evidencia reciente: API local 34 suites/281 tests PASS; auditoría pública en docs/GITHUB_SYNC.md. Capturas/respaldos privados siguen locales; typecheck histórico no aprobado.
- Próximo: revisar propuesta `codex/n01b-api-read-isolation` desde handoff, issue #2. Preparación/revocación de fixtures es mutación, separada del diagnóstico. B010 sigue sin ejecución acreditada; no lanzar agentes históricos ni nuevas pruebas remotas automáticamente.





## Actualización 2026-11-02 — REN-COB-01

- Nueva feature `specs/009-cobranzas-cuotas-deudas/` con SDD/TDD `docs/architecture/REN-COB-01-sdd-tdd-spec.md`, ADR `docs/architecture/ADR-REN-COB-01-contractual-ledger.md` y evidencia SQL.
- Se creó módulo independiente de cuentas por cobrar: cuotas, pagos parciales, estados vencidos y anulaciones auditadas. Aparte de compras de cupo SaaS, garantías y fiscalidad.
- Migración aditiva aplicada a Supabase Beta; no genera cuotas ni cobros automáticamente. Pruebas SQL transaccionales PASS, sin modificar los 2 alquileres actuales.
- API y web compilan en Vercel; Vitest, Playwright con sesiones reales y concurrencia simultánea NO RUN. No se utilizaron GitHub Actions.
- Estado de feature: implementada y con validación SQL/compilación, **pendiente de aceptación funcional real**. Los estados históricos N01–N08 arriba no se convierten en PASS por esta entrega.

## Actualización 2026-11-02 — REN-DISP-01 Disponibilidad

- Auditoría de la implementación y de Spec Kit 003: GiST de conflictos confirmado y probado; diferencias entre política de bloqueo por seña de la especificación y bloqueo de todo alquiler registrado en implementación (NO resolver sin decisión de negocio).
- Proyección segura y limitada de ocupaciones (SQL RPC + API pública/autenticada); calendario público orientativo; consulta previa en wizard; error concurrente `23P01` mapeado a 409.
- Documento de alcance, hallazgos y pruebas en `specs/003-modality-aware-availability/evidence/2026-11-02-audit-and-projection.md`.
- Pendientes: configurar cierres manuales, horarios, buffer e herencia por grupos, calendario operativo completo, ejecutar Vitest/Playwright y aceptación funcional con cuentas reales. No presentar ausencia de reservas como disponibilidad garantizada.
