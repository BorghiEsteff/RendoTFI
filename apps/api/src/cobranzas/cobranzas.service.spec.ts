import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { statusCuota, CobranzasService } from './cobranzas.service.js';
import { CobranzasController } from './cobranzas.controller.js';

describe('Cobranzas MVP: saldo y mora deterministas', () => {
  it('distingue pago total, parcial, pendiente y mora con fecha local', () => {
    expect(statusCuota(300000, 300000, '2026-11-01', '2026-11-02')).toBe('pagada');
    expect(statusCuota(300000, 120000, '2026-11-04', '2026-11-02')).toBe('parcial');
    expect(statusCuota(300000, 120000, '2026-11-01', '2026-11-02')).toBe('vencida');
    expect(statusCuota(300000, 0, '2026-11-02', '2026-11-02')).toBe('pendiente');
  });

  it('rechaza importes sin centavos exactos antes de llamar la base', async () => {
    const rpc = vi.fn();
    const service = new CobranzasService({getClient: () => ({rpc})} as any);
    await expect(service.registrarPago('jwt', 'c1',
      {importe: 0.001, fecha_pago: '2026-11-02', medio: 'efectivo'})).rejects.toThrow(BadRequestException);
    await expect(service.registrarPago('jwt', 'c1',
      {importe: -1, fecha_pago: '2026-11-02', medio: 'efectivo'})).rejects.toThrow(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('envía la identidad solo mediante JWT y jamás confía en gestor_id del cliente', async () => {
    const rpc = vi.fn().mockResolvedValue({data: 'payment-uuid', error: null});
    const service = new CobranzasService({getClient: () => ({rpc})} as any);
    await expect(service.registrarPago('jwt-operador', 'cuota-1', {
      importe: 0.29, fecha_pago: '2026-11-02', medio: 'efectivo',
    })).resolves.toEqual({id: 'payment-uuid', cuota_id: 'cuota-1', mensaje: 'Cobro registrado'});
    expect(rpc).toHaveBeenCalledWith('cobranzas_registrar_pago', {
      p_cuota: 'cuota-1', p_importe: 0.29, p_fecha_pago: '2026-11-02',
      p_medio: 'efectivo', p_referencia: null,
    });
  });

  it('deniega generar cuotas si el delegado no administra ese alquiler', async () => {
    const generarPlan = vi.fn();
    const controller = new CobranzasController({generarPlan} as any,
      {canManageAlquiler: vi.fn().mockResolvedValue(false)} as any);
    await expect(controller.generar('rent-1', {user: {
      id: 'delegado',rol:'delegado',workspace_id:'gestor-1',
    },headers:{authorization:'Bearer jwt'}} as any)).rejects.toThrow(ForbiddenException);
    expect(generarPlan).not.toHaveBeenCalled();
  });

  it('deniega cobros si no tiene alcance aunque pueda consultar la cuota', async () => {
    const registrarPago = vi.fn();
    const controller = new CobranzasController({
      findCuotaParent: vi.fn().mockResolvedValue('rent-1'), registrarPago,
    } as any, {canManageAlquiler: vi.fn().mockResolvedValue(false)} as any);
    await expect(controller.registrar('cuota-1',
      {importe:1200,fecha_pago:'2026-11-02',medio:'efectivo'} as any,
      {user:{id:'delegate',rol:'delegado',workspace_id:'gestor-1'},
       headers:{authorization:'Bearer jwt'}} as any)).rejects.toThrow(ForbiddenException);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it('el cálculo excluye asientos anulados y muestra importes parciales', async () => {
    const rows = [{
      id:'cuota-1', gestor_id:'gestor-1', alquiler_id:'renta-1', numero:1,
      periodo_inicio:'2026-11-01',vencimiento:'2026-11-30', monto:300000,
      pagos:[
        {id:'p-1',importe:120000,anulado_at:null,tipo:'cobro'},
        {id:'p-2',importe:50000,anulado_at:'2026-11-02',tipo:'cobro'},
      ],
    }];
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({
        data: rows, error:null, count:1,
      }),
    };
    const service = new CobranzasService({getClient: () => ({from:()=>query})} as any);
    const result = await service.findAll('jwt');
    expect(result.data[0]).toMatchObject({pagado:120000,saldo:180000});
    expect(result.resumen).toMatchObject({pagado:120000,saldo:180000,total_contratado:300000});
  });
});
