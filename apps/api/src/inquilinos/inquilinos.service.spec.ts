import {describe, expect, it, vi} from 'vitest';
import {InquilinosService} from './inquilinos.service.js';
import {BadRequestException, ConflictException, UnprocessableEntityException} from '@nestjs/common';

describe('InquilinosService.create: RLS compatible insert', () => {
  it('creates an orphan tenant without INSERT RETURNING and preserves workspace ownership', async () => {
    const insert = vi.fn().mockResolvedValue({error: null});
    const select = vi.fn();
    const from = vi.fn().mockReturnValue({insert, select});
    const service = new InquilinosService({getClient: vi.fn().mockReturnValue({from})} as any);

    const result = await service.create(
      {nombre_completo: 'Inquilino de prueba', email: 'test@example.invalid', documento: '12.345.678'} as any,
      'user-jwt', '11111111-1111-1111-1111-111111111111'
    );

    expect(result).toMatchObject({
      nombre_completo: 'Inquilino de prueba',
      email: 'test@example.invalid',
      documento: '12345678',
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
      {nombre_completo: 'Test', documento: '123456789', gestor_id: 'external', id: 'fake-id'} as any,
      'owner-token', 'owner-workspace'
    );
    expect(row.gestor_id).toBe('owner-workspace');
    expect(row.id).not.toBe('fake-id');
    expect(row.documento).toBe('123456789');
  });

  it('never returns a successful result when the RLS insert fails', async () => {
    const insert = vi.fn().mockResolvedValue({error: {message: 'new row violates row-level security policy for table "inquilinos"'}});
    const service = new InquilinosService({getClient: () => ({from: () => ({insert})})} as any);
    await expect(service.create({nombre_completo: 'Test', documento: '12345678'} as any, 'jwt', 'owner')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
  it('rejects missing or malformed DNI before database access', async () => {
    const insert = vi.fn();
    const service = new InquilinosService({getClient: () => ({from: () => ({insert})})} as any);
    await expect(service.create({nombre_completo: 'Test'} as any, 'jwt', 'owner')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({nombre_completo: 'Test', documento: 'abc'} as any, 'jwt', 'owner')).rejects.toBeInstanceOf(BadRequestException);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns 409 with a useful message for duplicate DNI from a different workspace', async () => {
    const insert = vi.fn().mockResolvedValue({error: {code: '23505', message: 'duplicate key value violates unique constraint "inquilinos_dni_global_unico_idx"'}});
    const service = new InquilinosService({getClient: () => ({from: () => ({insert})})} as any);
    await expect(service.create({nombre_completo: 'Otro', documento: '12.345.678'} as any, 'jwt', 'another-owner'))
      .rejects.toThrow(ConflictException);
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({documento: '12345678', gestor_id: 'another-owner'})]);
  });
});
