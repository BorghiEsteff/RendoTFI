import {test, expect} from '@playwright/test';
import {startMockApiServer, stopMockApiServer} from './fixtures/mock-api-server';

function gestorCookie() {
  const id = '11111111-1111-1111-1111-111111111111';
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({
    sub: id, accessContext: {actor: 'gestor', ownerOnly: true, capabilities: ['*']}
  })).toString('base64url')}.test`;
  const value = `base64-${Buffer.from(JSON.stringify({
    access_token: token, user: {id, email: 'gestor@example.invalid', user_metadata: {role: 'gestor'}}
  })).toString('base64')}`;
  return {name: 'sb-localhost-auth-token', value, domain: 'localhost', path: '/'};
}

test.describe('Alquiler: calendario Impeccable y mínimo hoy', () => {
  test.beforeAll(async () => { await startMockApiServer(3001); });
  test.afterAll(async () => { await stopMockApiServer(); });

  test('las fechas tienen controles cómodos y el calendario impide fechas pasadas', async ({page, context}) => {
    await context.clearCookies();
    await context.addCookies([gestorCookie()]);
    await page.goto('/es/alquileres');
    await page.getByTestId('btn-nuevo-alquiler').click();

    const section = page.getByTestId('alquiler-date-range');
    await expect(section).toBeVisible();
    await expect(section).toContainText('El inicio debe ser hoy');
    const start = page.getByTestId('date-picker-fecha_inicio');
    await expect(start).toBeVisible();
    const startBounds = await start.boundingBox();
    expect(startBounds?.height).toBeGreaterThanOrEqual(44);

    await start.click();
    const calendar = page.locator('[data-slot="calendar"]');
    await expect(calendar).toBeVisible();
    const day = calendar.locator('button[data-day]').first();
    await expect(day).toBeVisible();
    const cellBounds = await day.boundingBox();
    expect(cellBounds?.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText('Fechas disponibles desde el')).toBeVisible();
  });
});
