---
name: rendo-delivery
description: Use for Rendo beta changes to moderation, roles, Supabase RLS, payments, property publishing and verification.
---
# Rendo — entrega y seguridad
1. Inspeccionar implementación y esquemas reales antes de actualizar permisos, reportes, delegados o superadmin.
2. Verificar cada rol con pruebas positivas y negativas: gestor, delegado, inquilino y dev/superadmin; comprobar RLS directamente y por la UI.
3. Probar publicación/edición/borrador, invitaciones, moderación, reportes, disponibilidad, pagos y webhooks sin confiar solo en mocks.
4. Antes de publicar, ejecutar tests E2E de Playwright y comprobar qué rama se despliega en beta. No modificar producción sin autorización específica.
5. Informar cambios con commit, escenarios PASS/FAIL/NOT_RUN, capturas, logs y bloqueos; nunca afirmar que moderación funciona por ver el panel.