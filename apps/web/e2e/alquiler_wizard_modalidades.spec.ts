import { test, expect } from '@playwright/test';
import { startMockApiServer, stopMockApiServer } from './fixtures/mock-api-server';

function managerCookie() {
  const id = '11111111-1111-1111-1111-111111111111';
  const token = Buffer.from('{}').toString('base64url') + '.' +
    Buffer.from(JSON.stringify({
      sub: id, accessContext: {actor: 'gestor', ownerOnly: true, capabilities: ['*']},
    })).toString('base64url') + '.test';
  return {
    name: 'sb-localhost-auth-token',
    value: 'base64-' + Buffer.from(JSON.stringify({
      access_token: token,
      user: {id, email: 'gestor@example.invalid', user_metadata: {role: 'gestor'}},
    })).toString('base64'),
    domain: 'localhost', path: '/',
  };
}

test.describe('Asistente de alquiler con modalidades especializadas', () => {
  test.beforeAll(async () => { await startMockApiServer(3001); });
  test.afterAll(async () => { await stopMockApiServer(); });

  test.beforeEach(async ({page, context}) => {
    await context.clearCookies();
    await context.addCookies([managerCookie()]);
    // The manager list omits tariffs, but the detail endpoint provides them.
    // Keep deterministic test fixtures without a live account or external API.
    await page.route('**/unidades/a0000000-0000-0000-0000-000000000001', async (route) => {
      await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({
        id: 'a0000000-0000-0000-0000-000000000001',
        titulo_es: 'Unidad de prueba',
        grupo_id: null,
        modalidades_precio: [
          {unidad_tiempo: 'hora', cantidad_tiempo: 1, precio: 10000},
          {unidad_tiempo: 'día', cantidad_tiempo: 1, precio: 45000},
          {unidad_tiempo: 'mes', cantidad_tiempo: 1, precio: 300000},
        ],
      })});
    });
    await page.goto('/es/alquileres');
    await page.getByTestId('btn-nuevo-alquiler').click();
  });

  for (const [mode, price] of [
    ['por_hora', 10000], ['diaria', 45000], ['mensual', 300000],
  ] as const) {
    test(mode + ' valida datos, precio real y resumen antes de guardar', async ({page}) => {
      await page.getByTestId('modality-select').selectOption(mode);
      await page.locator('#unidad_id').selectOption('a0000000-0000-0000-0000-000000000001');
      await page.locator('#inquilino_id').selectOption({index: 1});
      await page.getByTestId('btn-guardar-alquiler').click();
      await expect(page.getByTestId('alquiler-wizard-precios')).toBeVisible();
      await expect(page.getByTestId('alquiler-tarifa-base')).toHaveValue(String(price));
      await expect(page.getByTestId('alquiler-precio-calculado')).toContainText('$');

      await page.getByTestId('btn-guardar-alquiler').click();
      await expect(page.getByTestId('alquiler-wizard-confirmacion')).toBeVisible();
      await expect(page.getByText('Revisá antes de confirmar')).toBeVisible();
      await page.getByRole('button', {name: 'Volver'}).click();
      await expect(page.getByTestId('alquiler-wizard-precios')).toBeVisible();
    });
  }

  test('la garantía no se registra como cobrada sin que el operador lo indique', async ({page}) => {
    await page.locator('#unidad_id').selectOption('a0000000-0000-0000-0000-000000000001');
    await page.locator('#inquilino_id').selectOption({index: 1});
    await page.getByTestId('btn-guardar-alquiler').click();
    await expect(page.getByTestId('alquiler-wizard-precios')).toBeVisible();
    await page.locator('#monto_deposito').fill('100000');
    await expect(page.locator('#deposito_recibido')).not.toBeChecked();
    await page.locator('#deposito_recibido').check();
    await expect(page.locator('#deposito_recibido')).toBeChecked();
    await page.locator('#monto_deposito').fill('0');
    await expect(page.locator('#deposito_recibido')).not.toBeChecked();
  });
});
