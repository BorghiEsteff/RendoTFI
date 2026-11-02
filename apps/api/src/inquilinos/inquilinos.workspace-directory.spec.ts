import { describe, expect, it, vi } from 'vitest';
import { InquilinosController } from './inquilinos.controller.js';
import { InquilinosService } from './inquilinos.service.js';

describe('Directorio de inquilinos compartido por gestor', () => {
  it('filtra por el workspace antes de paginar, manteniendo el total real', async () => {
    const data = [{ id: 'tenant-1', gestor_id: 'owner-A' }];
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data, count: 1, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(query) };
    const service = new InquilinosService({ getClient: () => client } as any);

    const result = await service.findAll('delegate-jwt', 'owner-A', 25, 50);
    expect(client.from).toHaveBeenCalledWith('inquilinos');
    expect(query.eq).toHaveBeenCalledWith('gestor_id', 'owner-A');
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.range).toHaveBeenCalledWith(50, 74);
    expect(result).toEqual({ data, total: 1, limit: 25, offset: 50 });
  });

  it('gestor y delegado consultan el mismo workspace; no filtra después de paginar', async () => {
    const result = { data: [{ id: 'tenant-shared' }], total: 1, limit: 10, offset: 0 };
    const findAll = vi.fn().mockResolvedValue(result);
    const controller = new InquilinosController({ findAll } as any, {} as any, {} as any);
    const manager = {
      user: { id: 'owner-A', rol: 'gestor', workspace_id: 'owner-A' },
      headers: { authorization: 'Bearer manager-token' },
    } as any;
    const delegate = {
      user: { id: 'delegate-A', rol: 'delegado', workspace_id: 'owner-A' },
      headers: { authorization: 'Bearer delegate-token' },
    } as any;

    expect(await controller.findAll(manager, '10', '0')).toEqual(result);
    expect(await controller.findAll(delegate, '10', '0')).toEqual(result);
    expect(findAll).toHaveBeenNthCalledWith(1, 'manager-token', 'owner-A', 10, 0);
    expect(findAll).toHaveBeenNthCalledWith(2, 'delegate-token', 'owner-A', 10, 0);
  });
});
