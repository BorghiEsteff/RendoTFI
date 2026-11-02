# 009 — Tareas y evidencia

- [x] REN-COB-01: especificación, SDD/TDD y ADR.
- [x] REN-COB-02: DDL aditivo, 2 tablas, RLS, privilegios mínimos y trigger protector.
- [x] REN-COB-03: RPC transaccional de generación, cobro parcial y anulación.
- [x] REN-COB-04: API con autenticación y permisos sobre alquiler.
- [x] REN-COB-05: página administrativa y enlace de navegación.
- [x] REN-COB-06: tests unitarios escritos; **ejecución Vitest no acreditada**.
- [x] REN-COB-07: pruebas SQL en rollback para cuotas, saldos y roles en Supabase Beta (sin mutaciones de contrato persistentes).
- [ ] REN-COB-08: validar casos E2E en navegador real con gestor y delegado y revisar UX escritorio.
- [ ] REN-COB-09: pruebas de concurrencia con solicitudes simultáneas reales; el bloqueo SQL está implementado, pero la carga concurrente no se ejecutó.
- [ ] REN-COB-10: verificación de recaudación y conciliación de montos heredados mediante casos reales.
- [ ] REN-COB-11: exportaciones y recibos (fase posterior, no incluidas en MVP).

## No utilizar GitHub Actions
Las compilaciones y pruebas deben usar Vercel, SQL en transacciones revertidas o runner local autorizado. No disparar workflows de GitHub.
