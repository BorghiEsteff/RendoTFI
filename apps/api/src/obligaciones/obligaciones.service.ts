import {
  BadRequestException, ConflictException, Injectable,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import type { AuthenticatedUser } from '../auth/supabase-auth.guard.js';
import { ActualizarObligacionDto, CrearObligacionDto, MarcarPeriodoDto } from './obligaciones.dto.js';
import {
  esPeriodoAplicable, mesNumero, resumenUnidad, vencimientoMes,
  type ObligacionBase, type PeriodoPago,
} from './obligaciones.logic.js';

const BAD_ID = 'Unidad u obligación no encontrada o fuera de alcance';

function validarPeriodo(value: string): string {
  if (mesNumero(value) === null) throw new BadRequestException('Período inválido (AAAA-MM)');
  return value;
}

function mesActual(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return p.year + '-' + p.month;
}

function hoyLocal(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return p.year + '-' + p.month + '-' + p.day;
}

@Injectable()
export class ObligacionesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async requireUnidad(actor: AuthenticatedUser, unidadId: string, manage = false): Promise<string> {
    const permitted = manage
      ? await this.authorization.canManageUnidad(actor, unidadId)
      : await this.authorization.canReadUnidad(actor, unidadId);
    if (!permitted) throw new NotFoundException(BAD_ID);
    const { data, error } = await this.supabase.getAdminClient()
      .from('unidades').select('gestor_id').eq('id', unidadId).is('deleted_at', null).maybeSingle();
    if (error || !data) throw new NotFoundException(BAD_ID);
    return data.gestor_id as string;
  }

  private async requireObligacion(
    actor: AuthenticatedUser, token: string, unidadId: string, obligacionId: string, manage = false,
  ): Promise<ObligacionBase & { gestor_id: string; unidad_id: string }> {
    await this.requireUnidad(actor, unidadId, manage);
    const { data, error } = await this.supabase.getClient(token)
      .from('unidad_obligaciones').select('*')
      .eq('id', obligacionId).eq('unidad_id', unidadId).maybeSingle();
    if (error) throw new InternalServerErrorException('Error al consultar la obligación');
    if (!data) throw new NotFoundException(BAD_ID);
    return data as ObligacionBase & { gestor_id: string; unidad_id: string };
  }

  /** Access checked for every requested unit before any privileged lookup. */
  async resumen(actor: AuthenticatedUser, token: string, unidadIds: string[], periodoRaw?: string) {
    const periodo = validarPeriodo(periodoRaw || mesActual());
    if (unidadIds.length > 100 || new Set(unidadIds).size !== unidadIds.length) {
      throw new BadRequestException('Solicitá entre 1 y 100 unidades distintas');
    }
    if (unidadIds.length === 0) return { periodo, unidades: {} };
    // Guardar el listado de unidades no depende de una política de publicación marketplace.
    await Promise.all(unidadIds.map(id => this.requireUnidad(actor, id)));
    const client = this.supabase.getClient(token);
    const [obligationsResult, paymentsResult] = await Promise.all([
      client.from('unidad_obligaciones').select('*').in('unidad_id', unidadIds).eq('activo', true).limit(1000),
      client.from('unidad_obligacion_periodos').select('*').in('unidad_id', unidadIds)
        .lte('periodo', periodo + '-01').limit(1000),
    ]);
    if (obligationsResult.error || paymentsResult.error) {
      throw new InternalServerErrorException('Error al obtener estados de obligaciones');
    }
    if (obligationsResult.data?.length === 1000 || paymentsResult.data?.length === 1000) {
      throw new InternalServerErrorException('Historial demasiado extenso para calcular el resumen sin truncarlo');
    }
    const obligaciones = (obligationsResult.data ?? []) as Array<ObligacionBase & { unidad_id: string }>;
    const pagos = (paymentsResult.data ?? []) as Array<PeriodoPago & { unidad_id: string }>;
    const today = hoyLocal();
    const unidades: Record<string, ReturnType<typeof resumenUnidad>> = {};
    for (const id of unidadIds) {
      unidades[id] = resumenUnidad(
        obligaciones.filter(o => o.unidad_id === id),
        pagos.filter(p => p.unidad_id === id),
        periodo, today,
      );
    }
    return { periodo, unidades };
  }

  async listar(actor: AuthenticatedUser, token: string, unidadId: string, periodoRaw?: string) {
    const periodo = validarPeriodo(periodoRaw || mesActual());
    await this.requireUnidad(actor, unidadId);
    const client = this.supabase.getClient(token);
    const [obligationsResult, paymentsResult] = await Promise.all([
      client.from('unidad_obligaciones').select('*').eq('unidad_id', unidadId)
        .order('created_at', { ascending: false }).limit(1000),
      client.from('unidad_obligacion_periodos').select('*').eq('unidad_id', unidadId)
        .lte('periodo', periodo + '-01').order('periodo', { ascending: false }).limit(1000),
    ]);
    if (obligationsResult.error || paymentsResult.error) {
      throw new InternalServerErrorException('Error al consultar gastos y obligaciones');
    }
    if (obligationsResult.data?.length === 1000 || paymentsResult.data?.length === 1000) {
      throw new InternalServerErrorException('El historial supera el máximo de consulta; no se mostrará incompleto');
    }
    const obligaciones = (obligationsResult.data ?? []) as ObligacionBase[];
    const periodos = (paymentsResult.data ?? []) as PeriodoPago[];
    return {
      periodo, obligaciones, periodos,
      resumen: resumenUnidad(obligaciones, periodos, periodo, hoyLocal()),
    };
  }

  async crear(actor: AuthenticatedUser, token: string, unidadId: string, dto: CrearObligacionDto) {
    const gestorId = await this.requireUnidad(actor, unidadId, true);
    validarPeriodo(dto.periodo_inicio);
    if (!dto.nombre?.trim()) throw new BadRequestException('Indicá un nombre para la obligación');
    const { data, error } = await this.supabase.getClient(token)
      .from('unidad_obligaciones')
      .insert({
        ...dto, nombre: dto.nombre.trim(), periodo_inicio: dto.periodo_inicio + '-01',
        gestor_id: gestorId, unidad_id: unidadId,
      }).select('*').single();
    if (error || !data) throw new BadRequestException('No se pudo registrar la obligación: ' + (error?.message || 'Sin respuesta'));
    return data;
  }

  async editar(
    actor: AuthenticatedUser, token: string, unidadId: string,
    obligacionId: string, dto: ActualizarObligacionDto,
  ) {
    const current = await this.requireObligacion(actor, token, unidadId, obligacionId, true);
    if (dto.nombre !== undefined && !dto.nombre.trim()) throw new BadRequestException('Nombre obligatorio');
    if (dto.periodo_inicio !== undefined) validarPeriodo(dto.periodo_inicio);
    if ((dto.frecuencia && dto.frecuencia !== current.frecuencia)
      || (dto.periodo_inicio && dto.periodo_inicio !== current.periodo_inicio.slice(0, 7))) {
      const { data, error } = await this.supabase.getClient(token)
        .from('unidad_obligacion_periodos').select('id').eq('obligacion_id', obligacionId).limit(1);
      if (error) throw new InternalServerErrorException('No se pudo verificar el historial');
      if (data?.length) throw new ConflictException('No se puede cambiar la frecuencia o fecha de inicio cuando hay historial. Archivá esta obligación y creá otra.');
    }
    const patch = {
      ...dto,
      ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
      ...(dto.periodo_inicio !== undefined ? { periodo_inicio: dto.periodo_inicio + '-01' } : {}),
    };
    const { data, error } = await this.supabase.getClient(token)
      .from('unidad_obligaciones').update(patch)
      .eq('id', obligacionId).eq('unidad_id', unidadId).select('*').single();
    if (error || !data) throw new BadRequestException('No se pudo actualizar la obligación');
    return data;
  }

  async marcar(
    actor: AuthenticatedUser, token: string, unidadId: string,
    obligacionId: string, dto: MarcarPeriodoDto,
  ) {
    const periodo = validarPeriodo(dto.periodo);
    const item = await this.requireObligacion(actor, token, unidadId, obligacionId, true);
    if (!esPeriodoAplicable(item, periodo)) throw new BadRequestException('Esta obligación no corresponde al período seleccionado');
    const pagado = dto.estado === 'pagado';
    const payment = {
      obligacion_id: obligacionId, unidad_id: unidadId, gestor_id: item.gestor_id,
      periodo: periodo + '-01', estado: dto.estado,
      monto_pagado: pagado ? (dto.monto_pagado ?? item.monto_estimado ?? null) : null,
      pagado_at: pagado ? new Date().toISOString() : null,
      pagado_por: pagado ? actor.id : null,
      notas: dto.notas ?? null,
    };
    const { data, error } = await this.supabase.getClient(token)
      .from('unidad_obligacion_periodos')
      .upsert(payment, { onConflict: 'obligacion_id,periodo' }).select('*').single();
    if (error || !data) throw new BadRequestException('No se pudo actualizar el pago: ' + (error?.message || 'Sin respuesta'));
    return data;
  }
}
