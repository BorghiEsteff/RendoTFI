# REN-COB-01 — Evidencias verificadas (2026-11-02)

**Entorno:** Supabase Beta, migración \`20261102214500_cobranzas_cuotas_ledger.sql\` aplicada. **Método:** \`execute_sql\` con \`BEGIN; ... ROLLBACK\` para todos los casos de negocio; no dejó cuotas ni pagos de ensayo en la base. **No GitHub Actions.**

| Compuerta | Resultado | Evidencia |
|---|---|---|
| Integridad de datos existentes | PASS | Preflight: 2 alquileres vigentes, 0 balances iniciales superiores al total. |
| Generación mensual idempotente | PASS | 2 invocaciones para el mismo contrato devuelven 1 cuota, sin duplicación. |
| Cobro parcial | PASS | $120.000 sobre $400.000; saldo legado sincronizado. |
| Sobrepago | PASS | Rechazo de $300.000 cuando restaban $280.000. |
| Cobro total | PASS | Total $400.000 y estado legado actualizado. |
| Anulación | PASS | Anular el primer cobro conserva $280.000 como total neto. |
| Histórico diario / seña | PASS | Plan único de $25.000 y apertura heredada exacta de $5.000, no ingreso nuevo. |
| Alcance de delegado | PASS | Delegado \`gestionar\` de grupo (unidad asignada temporalmente en transacción) puede generar y operar. |
| Aislamiento entre gestores | PASS | Gestor ajeno no consulta cuotas ni puede registrar cobros. |
| Delegado de solo lectura | PASS | Lectura permitida en unidad asignada; generación denegada. |
| Meses calendario / centavos | PASS | 6 cuotas, suma exacta $300.001,01 y vencimiento día 10. |
| Limpieza tras pruebas | PASS | Todos los cambios a contratos/unidades/delegaciones y todos los movimientos sintéticos se revirtieron. |
| API TypeScript | PASS | Compilación Vercel para SHA \`69275ee219b98cf21e389b862be645c2c6b34415\` (deploy \`dpl_Bk48ocPWUp8Cj3yCbGreyv4w6bwp\`) |
| Web Next.js | PASS | Compilación Vercel para SHA \`69275ee219b98cf21e389b862be645c2c6b34415\` (deploy \`dpl_3Q4miasK81ReMhUgRbdh3kUKvAfj\`) |
| Vitest | NOT RUN | Tests escritos en \`apps/api/src/cobranzas/cobranzas.service.spec.ts\`, no se ejecutaron desde runner local. |
| Playwright real | NOT RUN | Falta validar la UI en navegador con gestor y delegado reales. |
| Concurrencia simultánea | NOT RUN | Bloqueo de alquiler \`FOR UPDATE\` implementado, sin stress test concurrente. |

**Advertencia:** Un build correcto de Vercel no acredita interacciones reales con el servidor API ni la experiencia completa de navegador. No habilitar cobros automáticos o emisión fiscal a partir de esta evidencia.
