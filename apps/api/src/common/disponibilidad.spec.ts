import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { intersecan, obtenerDisponibilidad } from './disponibilidad.js';

const unit='11111111-1111-4111-8111-111111111111';
const from='2026-11-02T03:00:00.000Z';
const until='2026-11-10T03:00:00.000Z';

describe('Proyección de ocupación', () => {
  it('respeta intervalos semiabiertos: extremos adyacentes no colisionan', () => {
    const a={inicio_at:'2026-11-02T10:00:00Z',fin_at:'2026-11-02T12:00:00Z'};
    expect(intersecan(a,{inicio_at:'2026-11-02T12:00:00Z',fin_at:'2026-11-02T13:00:00Z'})).toBe(false);
    expect(intersecan(a,{inicio_at:'2026-11-02T11:59:59Z',fin_at:'2026-11-02T13:00:00Z'})).toBe(true);
    expect(intersecan(a,{inicio_at:'2026-11-02T09:00:00Z',fin_at:'2026-11-02T10:00:00Z'})).toBe(false);
    expect(intersecan(a,{inicio_at:'2026-11-02T09:00:00Z',fin_at:'2026-11-02T15:00:00Z'})).toBe(true);
  });

  it('rechaza ventanas inválidas sin consultar la base', async () => {
    const rpc=vi.fn();
    const supabase={getClient:vi.fn(()=>({rpc}))} as any;
    await expect(obtenerDisponibilidad(supabase,unit,until,from)).rejects.toThrow(BadRequestException);
    await expect(obtenerDisponibilidad(supabase,unit,'2026-11-01',until)).rejects.toThrow(BadRequestException);
    await expect(obtenerDisponibilidad(supabase,'missing',from,until)).rejects.toThrow(BadRequestException);
    await expect(obtenerDisponibilidad(supabase,unit,from,'2031-11-10T03:00:00Z')).rejects.toThrow(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('usa una función pública controlada y devuelve solamente ocupaciones', async () => {
    const result={unidad_id:unit,ocupaciones:[{inicio_at:from,fin_at:until}],truncado:false,
      reglas_operativas:'no_configuradas'};
    const rpc=vi.fn().mockResolvedValue({data:result,error:null});
    const supabase={getClient:vi.fn(()=>({rpc}))} as any;
    await expect(obtenerDisponibilidad(supabase,unit,from,until)).resolves.toEqual(result);
    expect(supabase.getClient).toHaveBeenCalledWith(undefined);
    expect(rpc).toHaveBeenCalledWith('disponibilidad_proyeccion',{
      p_unidad:unit,p_desde:from,p_hasta:until,
    });
  });

  it('responde 404 por unidad ajena/pausada pública y 503 por fallo SQL', async () => {
    const rpc=vi.fn().mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({
      data:null,error:{message:'database down'}
    });
    const supabase={getClient:vi.fn(()=>({rpc}))} as any;
    await expect(obtenerDisponibilidad(supabase,unit,from,until)).rejects.toThrow(NotFoundException);
    await expect(obtenerDisponibilidad(supabase,unit,from,until)).rejects.toThrow(ServiceUnavailableException);
  });

  it('usa JWT de delegado para consulta privada y no una clave de administrador', async () => {
    const rpc=vi.fn().mockResolvedValue({data:{
      unidad_id:unit,ocupaciones:[],truncado:false,reglas_operativas:'no_configuradas'
    },error:null});
    const supabase={getClient:vi.fn(()=>({rpc}))} as any;
    await obtenerDisponibilidad(supabase,unit,from,until,'jwt-del-delegado');
    expect(supabase.getClient).toHaveBeenCalledWith('jwt-del-delegado');
  });
});
