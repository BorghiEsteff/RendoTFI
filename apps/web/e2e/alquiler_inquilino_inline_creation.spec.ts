import {test, expect} from '@playwright/test';
import {startMockApiServer, stopMockApiServer} from './fixtures/mock-api-server';

function gestorCookie() {
  const id = '11111111-1111-1111-1111-111111111111';
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({
    sub: id, accessContext: {actor: 'gestor', ownerOnly: true, capabilities: ['*']}
  })).toString('base64url')}.test`;
  return {
    name: 'sb-localhost-auth-token',
    value: `base64-${Buffer.from(JSON.stringify({
      access_token: token, user: {id, email: 'gestor@example.invalid', user_metadata: {role: 'gestor'}}
    })).toString('base64')}`,
    domain: 'localhost', path: '/'
  };
}

test.describe('Inquilino creado desde un alquiler queda seleccionado', () => {
  test.beforeAll(async () => { await startMockApiServer(3001); });
  test.afterAll(async () => { await stopMockApiServer(); });

  test('alta, consentimiento y selección del nuevo inquilino sin perder el borrador', async ({page, context}) => {
    await context.clearCookies();
    await context.addCookies([gestorCookie()]);
    await page.goto('/es/alquileres');
    await page.getByTestId('btn-nuevo-alquiler').click();

    await page.locator('#unidad_id').selectOption({index: 1});
    await page.locator('#monto_total').fill('150000');
    const tenant = page.locator('#inquilino_id');
    await expect(tenant).toHaveValue('');

    // Exercise the existing required-field validation before creating the tenant.
    await page.getByTestId('btn-guardar-alquiler').click();
    await expect(page.locator('#alquiler-inquilino-error')).toBeVisible();

    await page.getByRole('button', {name: /Inquilino/}).last().click();
    await expect(page.getByTestId('FORM-004')).toBeVisible();
    await page.locator('#nombre_completo').fill('Mariana Inquilina');
    await page.locator('#documento').fill('12.345.678');
    await page.getByTestId('FORM-004').getByRole('button', {name: 'Continuar'}).click();
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', {name: 'Confirmar y Guardar'}).click();

    await expect(page.getByTestId('alquiler-inquilino-creado')).toContainText('Mariana Inquilina');
    await expect(tenant).toHaveValue('i0000000-0000-0000-0000-000000000002');
    await expect(tenant.locator('option:checked')).toContainText('Mariana Inquilina');
    await expect(page.locator('#alquiler-inquilino-error')).toHaveCount(0);
    await expect(page.locator('#monto_total')).toHaveValue('150000');

    // No need to re-open the form or re-select manually after successful creation.
    await page.getByTestId('btn-guardar-alquiler').click();
    await expect(page.getByTestId('alquiler-validation-summary')).toHaveCount(0);
  });
});
