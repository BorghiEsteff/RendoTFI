import {describe, expect, it, vi} from 'vitest';
import {InquilinosService} from './inquilinos.service.js';
import {UnprocessableEntityException} from '@nestjs/common';

describe('InquilinosService.create: RLS compatible insert', () => {
  it('creates an orphan tenant without INSERT RETURNING and preserves workspace ownership', async () => {
    const insert = vi.fn().mockResolvedValue({error: null});
    const select = vi.fn();
    const from = vi.fn().mockReturnValue({insert, select});
    const service = new InquilinosService({getClient: vi.fn().mockReturnValue({from})} as any);

    const result = await service.create(
      {nombre_completo: 'Inquilino de prueba', email: 'test@example.invalid'} as any,
      'user-jwt', '11111111-1111-1111-1111-111111111111'
    );

    expect(result).toMatchObject({
      nombre_completo: 'Inquilino de prueba',
      email: 'test@example.invalid',
      gestor_id: '11111111-1111-1111-1111-111111111111',
      id: expect.any(String)
    });
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({id: result.id})]);
    expect(select).not.toHaveBeenCalled();
  });

  it('does not allow body data to override gestor_id or id', async () => {
    const insert = vi.fn().mockResolvedValue({error: null});
    const service = new InquilinosService({getClient: () => ({from: () => ({insert})})} as any);
    const row = await service.create(
      {nombre_completo: 'Test', gestor_id: 'external', id: 'fake-id'} as any,
      'owner-token', 'owner-workspace'
    );
    expect(row.gestor_id).toBe('owner-workspace');
    expect(row.id).not.toBe('fake-id');
  });

  it('never returns a successful result when the RLS insert fails', async () => {
    const insert = vi.fn().mockResolvedValue({error: {message: 'new row violates row-level security policy for table "inquilinos"'}});
    const service = new InquilinosService({getClient: () => ({from: () => ({insert})})} as any);
    await expect(service.create({nombre_completo: 'Test'} as any, 'jwt', 'owner')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
