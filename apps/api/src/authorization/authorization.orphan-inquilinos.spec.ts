import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import type { AuthenticatedUser } from '../auth/supabase-auth.guard.js';

const owner = { id: 'owner-A', rol: 'gestor', workspace_id: 'owner-A' } as AuthenticatedUser;
const manager = { id: 'delegate-A', rol: 'delegado', workspace_id: 'owner-A' } as AuthenticatedUser;
const colleague = { id: 'delegate-B', rol: 'delegado', workspace_id: 'owner-A' } as AuthenticatedUser;
const outsider = { id: 'outside-delegate', rol: 'delegado', workspace_id: 'owner-B' } as AuthenticatedUser;

function setup({ archived = false, linked = false } = {}) {
  const tenant = { id: 'tenant-1', gestor_id: 'owner-A',
    created_by: 'someone-else', deleted_at: archived ? '2026-11-02T21:15:00Z' : null };
  const tenantQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: tenant, error: null }),
  };
  const rentalsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: linked ? [{ unidad_id: 'unit-1' }] : [], error: null }),
  };
  const client = { from: vi.fn((name: string) =>
    name === 'inquilinos' ? tenantQuery : rentalsQuery) };
  const service = new AuthorizationService({ getAdminClient: () => client } as any);
  const getActiveDelegation = vi.spyOn(service, 'getActiveDelegation')
    .mockImplementation(async (delegateId: string, workspaceId: string) => {
      if (workspaceId !== 'owner-A' || delegateId === 'outside-delegate') return null;
      return { delegado_id: delegateId, gestor_id: workspaceId,
        estado: 'activa', permiso: 'gestionar', alcance_tipo: 'grupo' } as any;
    });
  return { service, getActiveDelegation, tenantQuery };
}

describe('Workspace-shared tenant directory authorization', () => {
  it('the gestor and different active delegates share the same tenant, regardless of who created it', async () => {
    const { service } = setup();
    expect(await service.canReadInquilino(owner, 'tenant-1')).toBe(true);
    expect(await service.canReadInquilino(manager, 'tenant-1')).toBe(true);
    expect(await service.canReadInquilino(colleague, 'tenant-1')).toBe(true);
    expect(await service.canManageInquilino(manager, 'tenant-1')).toBe(true);
    expect(await service.canManageInquilino(colleague, 'tenant-1')).toBe(true);
  });

  it('active read-only delegates can consult the directory but never edit it', async () => {
    const { service, getActiveDelegation } = setup();
    getActiveDelegation.mockResolvedValue({ estado: 'activa', permiso: 'ver' } as any);
    expect(await service.canReadInquilino(manager, 'tenant-1')).toBe(true);
    expect(await service.canManageInquilino(manager, 'tenant-1')).toBe(false);
  });

  it('an unrelated gestor workspace does not expose its tenants to a delegate', async () => {
    const { service } = setup();
    expect(await service.canReadInquilino(outsider, 'tenant-1')).toBe(false);
    expect(await service.canManageInquilino(outsider, 'tenant-1')).toBe(false);
  });

  it('revocation immediately denies both reading and editing', async () => {
    const { service, getActiveDelegation } = setup();
    getActiveDelegation.mockResolvedValue(null);
    expect(await service.canReadInquilino(manager, 'tenant-1')).toBe(false);
    expect(await service.canManageInquilino(manager, 'tenant-1')).toBe(false);
  });

  it('archived tenants are not editable but their names remain readable inside permitted rental history', async () => {
    const { service } = setup({ archived: true, linked: true });
    const scope = vi.spyOn(service, 'canReadUnidad').mockResolvedValue(true);
    expect(await service.canManageInquilino(manager, 'tenant-1')).toBe(false);
    expect(await service.canReadInquilino(manager, 'tenant-1')).toBe(true);
    scope.mockResolvedValue(false);
    expect(await service.canReadInquilino(manager, 'tenant-1')).toBe(false);
  });
});
