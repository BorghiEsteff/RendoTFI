import {describe, expect, it, vi} from 'vitest';
import {InternalServerErrorException} from '@nestjs/common';
import {DelegadosService} from './delegados.service.js';
import type {AuthenticatedUser} from '../auth/supabase-auth.guard.js';

const owner: AuthenticatedUser = {id: 'owner-1', rol: 'gestor', workspace_id: 'owner-1'};
const recipient: AuthenticatedUser = {id: 'recipient-1', rol: 'buscador', workspace_id: 'recipient-1'};

function setup(invitationResult: {data: any[] | null; error: any}, delegationResult: {data: any[] | null; error: any} = {data: [], error: null}) {
  const invitationsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(invitationResult)
  };
  const delegationsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(delegationResult)
  };
  const from = vi.fn((table: string) => {
    if (table === 'invitaciones_delegados') return invitationsQuery;
    if (table === 'delegaciones') return delegationsQuery;
    throw new Error(`Unexpected table ${table}`);
  });
  const service = new DelegadosService(
    {getAdminClient: () => ({from})} as any,
    {assertOwnerOnly: vi.fn()} as any,
    {} as any,
    {} as any
  );
  return {service, invitationsQuery, delegationsQuery};
}

describe('delegados invitation and permission listing against production profile schema', () => {
  it('lists pending invitations from the real users profile columns (no users.email)', async () => {
    const {service, invitationsQuery} = setup({
      data: [{id: 'inv-1', estado: 'pendiente', expires_at: '2026-11-09T00:00:00Z',
        created_at: '2026-11-02T00:00:00Z', gestor: {id: owner.id, full_name: 'Gestor de prueba'}}],
      error: null
    });
    const rows = await service.listReceivedInvitations(recipient);
    expect(rows).toMatchObject([{id: 'inv-1', estado: 'pendiente', gestorDisplayName: 'Gestor de prueba'}]);
    expect(invitationsQuery.select).toHaveBeenCalledWith('*, gestor:users!gestor_id(id, full_name)');
    expect(invitationsQuery.eq).toHaveBeenCalledWith('delegado_id', recipient.id);
  });

  it('does not lie that inbox is empty when PostgREST rejects a query', async () => {
    const {service} = setup({data: null, error: {message: 'PostgREST column not found'}});
    await expect(service.listReceivedInvitations(recipient)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("lists owner invitations and delegations without non-existent users.email", async () => {
    const {service, invitationsQuery, delegationsQuery} = setup({
      data: [{
        id: 'inv-1', delegado_id: recipient.id, email_snapshot: 'recipient@example.test',
        estado: 'aceptada', expires_at: '2026-11-09T00:00:00Z', created_at: '2026-11-02T00:00:00Z',
        target: {id: recipient.id, full_name: 'Colaborador'}
      }], error: null
    }, {
      data: [{
        id: 'del-1', delegado_id: recipient.id, invitacion_id: 'inv-1',
        estado: 'aceptada_sin_configurar', permiso: null, alcance_tipo: null,
        grupo: null, updated_at: '2026-11-02T00:00:00Z',
        delegado: {id: recipient.id, full_name: 'Colaborador'}
      }], error: null
    });
    const result = await service.listDelegados(owner);
    expect(result.invitaciones).toHaveLength(1);
    expect(result.delegaciones).toHaveLength(1);
    expect(result.delegaciones[0].delegado?.maskedEmail).toBe('r***t@example.test');
    expect(invitationsQuery.select).toHaveBeenCalledWith('*, target:users!delegado_id(id, full_name)');
    expect(delegationsQuery.select).toHaveBeenCalledWith(expect.not.stringContaining('email'));
  });

  it('does not report the manager has no invitations on a failed query', async () => {
    const {service} = setup({data: null, error: {message: 'PGRST200'}});
    await expect(service.listDelegados(owner)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('does not report no delegations when the delegation query fails', async () => {
    const {service} = setup({data: [], error: null}, {data: null, error: {message: 'PGRST200'}});
    await expect(service.listDelegados(owner)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
