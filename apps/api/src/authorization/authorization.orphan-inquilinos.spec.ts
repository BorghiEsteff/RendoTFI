import {describe, expect, it, vi} from 'vitest';
import {AuthorizationService} from './authorization.service.js';
import type {AuthenticatedUser} from '../auth/supabase-auth.guard.js';

const creator: AuthenticatedUser = {
  id: 'delegate-creator', rol: 'delegado', workspace_id: 'owner-workspace'
};
const other: AuthenticatedUser = {
  id: 'delegate-other', rol: 'delegado', workspace_id: 'owner-workspace'
};

function scopedAuthorizer(linkedUnits: string[] = []) {
  const tenant = {
    id: 'tenant-1', gestor_id: 'owner-workspace',
    creado_por: 'delegate-creator', deleted_at: null
  };
  const tenantQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({data: tenant, error: null})
  };
  const rentalQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({
      data: linkedUnits.map((unidad_id) => ({id: unidad_id, unidad_id})),
      error: null
    })
  };
  const client = {
    from: vi.fn((table: string) => table === 'inquilinos' ? tenantQuery : rentalQuery)
  };
  const service = new AuthorizationService({getAdminClient: () => client} as any);
  const active = {
    id: 'del-1', gestor_id: 'owner-workspace',
    delegado_id: 'delegate-creator', estado: 'activa',
    permiso: 'gestionar', alcance_tipo: 'grupo'
  };
  vi.spyOn(service, 'getActiveDelegation').mockResolvedValue(active as any);
  return {service, tenantQuery, rentalQuery};
}

describe('orphan tenant access for delegates', () => {
  it('permits an active managing delegate to read and manage only their own orphan tenant', async () => {
    const {service, tenantQuery} = scopedAuthorizer();
    expect(await service.canReadInquilino(creator, 'tenant-1')).toBe(true);
    expect(await service.canManageInquilino(creator, 'tenant-1')).toBe(true);
    expect(tenantQuery.select).toHaveBeenCalledWith('id, gestor_id, creado_por, deleted_at');
  });

  it('does not expose a colleague-created tenant to another delegate', async () => {
    const {service} = scopedAuthorizer();
    expect(await service.canReadInquilino(other, 'tenant-1')).toBe(false);
    expect(await service.canManageInquilino(other, 'tenant-1')).toBe(false);
  });

  it('revocation or read-only permission denies creator access to orphan tenant', async () => {
    const {service} = scopedAuthorizer();
    vi.spyOn(service, 'getActiveDelegation').mockResolvedValue({
      estado: 'activa', permiso: 'ver'
    } as any);
    expect(await service.canReadInquilino(creator, 'tenant-1')).toBe(false);
    expect(await service.canManageInquilino(creator, 'tenant-1')).toBe(false);
  });

  it('after association, the unit scope determines visibility, not creation identity', async () => {
    const {service} = scopedAuthorizer(['unit-outside-scope']);
    vi.spyOn(service, 'canReadUnidad').mockResolvedValue(false);
    vi.spyOn(service, 'canManageUnidad').mockResolvedValue(false);
    expect(await service.canReadInquilino(creator, 'tenant-1')).toBe(false);
    expect(await service.canManageInquilino(creator, 'tenant-1')).toBe(false);
  });
});
