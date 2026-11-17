import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ObligacionesService } from './obligaciones.service.js';
import type { AuthenticatedUser } from '../auth/supabase-auth.guard.js';
import type { AuthorizationService } from '../authorization/authorization.service.js';
import type { SupabaseService } from '../supabase/supabase.service.js';

const actor = { id: 'a0000000-0000-0000-0000-000000000001', rol: 'delegado' } as AuthenticatedUser;
const unitId = 'a0000000-0000-0000-0000-000000000002';
const obligationId = 'a0000000-0000-0000-0000-000000000003';

function mockService(read: boolean, manage: boolean) {
  const authz = {
    canReadUnidad: vi.fn().mockResolvedValue(read),
    canManageUnidad: vi.fn().mockResolvedValue(manage),
  };
  const db = {
    getAdminClient: vi.fn(() => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { gestor_id: actor.id }, error: null }),
      };
      return { from: vi.fn(() => query) };
    }),
    getClient: vi.fn(),
  };
  const service = new ObligacionesService(
    db as unknown as SupabaseService,
    authz as unknown as AuthorizationService,
  );
  return { service, authz, db };
}

describe('Gastos — autorización en cada recurso', () => {
  it('no consulta tablas ni devuelve datos de unidades fuera de alcance', async () => {
    const { service, db } = mockService(false, false);
    await expect(service.listar(actor, 'valid-token', unitId)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.getAdminClient).not.toHaveBeenCalled();
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('delegado de solo lectura no puede crear, editar ni registrar pagos', async () => {
    const { service, db } = mockService(true, false);
    const createDto = {
      nombre: 'Expensas', tipo: 'expensas', frecuencia: 'mensual', periodo_inicio: '2026-11',
      dia_vencimiento: 10, responsable: 'propietario', moneda: 'ARS',
    } as any;
    await expect(service.crear(actor, 'valid-token', unitId, createDto)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.editar(actor, 'valid-token', unitId, obligationId, { activo: false })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.marcar(actor, 'valid-token', unitId, obligationId, { periodo: '2026-11', estado: 'pagado' })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('la consulta de resumen no permite incluir una unidad ajena junto a una propia', async () => {
    const { service, authz, db } = mockService(true, true);
    authz.canReadUnidad.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const foreign = 'b0000000-0000-0000-0000-000000000004';
    await expect(service.resumen(actor, 'valid-token', [unitId, foreign], '2026-11')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('rechaza períodos mal formados antes de tocar la base', async () => {
    const { service, db } = mockService(true, true);
    await expect(service.resumen(actor, 'valid-token', [unitId], '2026-99')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.getClient).not.toHaveBeenCalled();
  });
});
