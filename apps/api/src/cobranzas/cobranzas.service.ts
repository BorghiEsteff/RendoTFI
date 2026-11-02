import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { getBuenosAiresCalendarDate } from '@tfi/types';

export interface CobranzaPago {
  id: string;
  importe: number;
  tipo: 'apertura' | 'cobro';
  medio: string | null;
  fecha_pago: string | null;
  referencia: string | null;
  registrado_por: string | null;
  anulado_at: string | null;
  anulado_por: string | null;
  motivo_anulacion: string | null;
  created_at: string;
}

export interface CuotaConSaldo {
  id: string;
  gestor_id: string;
  alquiler_id: string;
  numero: number;
  periodo_inicio: string;
  vencimiento: string;
  monto: number;
  pagado: number;
  saldo: number;
  estado: 'pagada' | 'vencida' | 'parcial' | 'pendiente';
  alquiler?: {
    id: string;
    modalidad: string;
    unidad?: { titulo_es?: string } | null;
    inquilino?: { nombre_completo?: string } | null;
  } | null;
  pagos: CobranzaPago[];
}

export function statusCuota(monto: number, pagado: number, vencimiento: string, today: string):
  CuotaConSaldo['estado'] {
  if (monto - pagado <= 0) return 'pagada';
  if (vencimiento < today) return 'vencida';
  if (pagado > 0) return 'parcial';
  return 'pendiente';
}

@Injectable()
export class CobranzasService {
  constructor(private readonly supabase: SupabaseService) {}

  private fail(error: { code?: string; message: string }): never {
    const message = error.message || 'No se pudo completar la operación';
    switch (error.code) {
      case '42501': throw new ForbiddenException(message);
      case 'P0002': case 'PGRST116': throw new NotFoundException(message);
      case '22023': case '22007': case '22008': throw new BadRequestException(message);
      case '23505': throw new ConflictException(message);
      default: throw new UnprocessableEntityException(message);
    }
  }

  async findAll(token: string, limit = 100, offset = 0, alquilerId?: string): Promise<{
    data: CuotaConSaldo[];
    total: number;
    limit: number;
    offset: number;
    resumen: { total_contratado: number; pagado: number; saldo: number; vencido: number };
  }> {
    const client = this.supabase.getClient(token);
    let query = client.from('cobranza_cuotas')
      .select(
        'id,gestor_id,alquiler_id,numero,periodo_inicio,vencimiento,monto,' +
        'alquiler:alquileres(id,modalidad,unidad:unidades(titulo_es),inquilino:inquilinos(nombre_completo)),' +
        'pagos:cobranza_pagos(id,importe,tipo,medio,fecha_pago,referencia,registrado_por,anulado_at,anulado_por,motivo_anulacion,created_at)',
        { count: 'exact' },
      );
    if (alquilerId) query = query.eq('alquiler_id', alquilerId);
    const { data, error, count } = await query
      .order('vencimiento', { ascending: true })
      .order('numero', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) this.fail(error);

    const today = getBuenosAiresCalendarDate(new Date());
    const cuotas: CuotaConSaldo[] = (data || []).map((raw: any) => {
      const payments = (raw.pagos || []) as CobranzaPago[];
      const total = Number(raw.monto);
      const paid = Math.round(payments
        .filter((p) => !p.anulado_at)
        .reduce((acc, p) => acc + Math.round(Number(p.importe) * 100), 0)) / 100;
      const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
      return {
        id: raw.id, gestor_id: raw.gestor_id, alquiler_id: raw.alquiler_id,
        numero: raw.numero, periodo_inicio: raw.periodo_inicio, vencimiento: raw.vencimiento,
        monto: total, pagado: paid, saldo: balance,
        estado: statusCuota(total, paid, raw.vencimiento, today),
        alquiler: raw.alquiler || null,
        pagos: payments,
      };
    });
    const resumen = cuotas.reduce((sum, c) => ({
      total_contratado: sum.total_contratado + c.monto,
      pagado: sum.pagado + c.pagado,
      saldo: sum.saldo + c.saldo,
      vencido: sum.vencido + (c.estado === 'vencida' ? c.saldo : 0),
    }), { total_contratado: 0, pagado: 0, saldo: 0, vencido: 0 });
    return { data: cuotas, total: count || 0, limit, offset, resumen };
  }

  async findCuotaParent(token: string, cuotaId: string): Promise<string> {
    const client = this.supabase.getClient(token);
    const { data, error } = await client.from('cobranza_cuotas')
      .select('alquiler_id').eq('id', cuotaId).single();
    if (error || !data) throw new NotFoundException('Cuota no encontrada');
    return data.alquiler_id;
  }

  async findPagoParent(token: string, pagoId: string): Promise<string> {
    const client = this.supabase.getClient(token);
    const { data, error } = await client.from('cobranza_pagos')
      .select('alquiler_id').eq('id', pagoId).single();
    if (error || !data) throw new NotFoundException('Pago no encontrado');
    return data.alquiler_id;
  }

  async generarPlan(token: string, alquilerId: string) {
    const { data, error } = await this.supabase.getClient(token).rpc(
      'cobranzas_generar_plan', { p_alquiler: alquilerId },
    );
    if (error) this.fail(error);
    return { alquiler_id: alquilerId, cuotas: Number(data), mensaje: 'Plan de cuotas disponible' };
  }

  async registrarPago(
    token: string, cuotaId: string, dto: { importe: number; fecha_pago: string; medio: string; referencia?: string },
  ) {
    if (!Number.isFinite(dto.importe) || dto.importe <= 0 ||
        dto.importe > 99999999999 || Math.abs(Math.round(dto.importe * 100) - dto.importe * 100) > 0.000001) {
      throw new BadRequestException('El importe debe ser positivo y tener como máximo dos decimales');
    }
    const { data, error } = await this.supabase.getClient(token).rpc('cobranzas_registrar_pago', {
      p_cuota: cuotaId,
      p_importe: dto.importe,
      p_fecha_pago: dto.fecha_pago,
      p_medio: dto.medio,
      p_referencia: dto.referencia || null,
    });
    if (error) this.fail(error);
    return { id: data as string, cuota_id: cuotaId, mensaje: 'Cobro registrado' };
  }

  async anularPago(token: string, pagoId: string, motivo: string) {
    const { data, error } = await this.supabase.getClient(token)
      .rpc('cobranzas_anular_pago', { p_pago: pagoId, p_motivo: motivo });
    if (error) this.fail(error);
    return { id: pagoId, anulado: data === true };
  }
}
