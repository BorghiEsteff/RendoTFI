import {describe, it, expect, vi, afterEach} from 'vitest';
import {BadRequestException} from '@nestjs/common';
import {getBuenosAiresCalendarDate} from '@tfi/types';
import {AlquileresController} from './alquileres.controller.js';

function timestampInArgentina(day: string): string {
  return new Date(`${day}T12:00:00-03:00`).toISOString();
}

describe('AlquileresController: fecha mínima de alta', () => {
  afterEach(() => vi.useRealTimers());

  it('rechaza una fecha de inicio anterior a hoy sin consultar datos ni escribir', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T02:30:00.000Z'));
    // At 02:30 UTC it is still 2026-11-01 in Argentina.
    const create = vi.fn();
    const canManageUnidad = vi.fn();
    const controller = new AlquileresController(
      {create} as any, {canManageUnidad} as any, {} as any,
    );
    const req = {user: {id:'owner-1',rol:'gestor',workspace_id:'owner-1'},headers:{authorization:'Bearer token'}} as any;
    const yesterday = '2026-10-31';
    await expect(controller.create({inicio_at: timestampInArgentina(yesterday),unidad_id:'u-1'} as any,req))
      .rejects.toThrow(BadRequestException);
    expect(canManageUnidad).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('admite el día actual en Argentina incluso si UTC ya pasó a mañana', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T02:30:00.000Z'));
    const today = getBuenosAiresCalendarDate(new Date());
    const create = vi.fn().mockResolvedValue({id: 'rental-1'});
    const canManageUnidad = vi.fn().mockResolvedValue(true);
    const controller = new AlquileresController(
      {create} as any, {canManageUnidad} as any, {} as any,
    );
    const req = {user: {id:'owner-1',rol:'gestor',workspace_id:'owner-1'},headers:{authorization:'Bearer token'}} as any;
    const dto = {inicio_at:timestampInArgentina(today),unidad_id:'u-1'};
    await expect(controller.create(dto as any,req)).resolves.toEqual({id:'rental-1'});
    expect(create).toHaveBeenCalledTimes(1);
  });
});
