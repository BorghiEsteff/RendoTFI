import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface OcupacionIntervalo { inicio_at: string; fin_at: string; }
export interface DisponibilidadProyeccion {
  unidad_id: string;
  desde: string;
  hasta: string;
  estado_publicacion: string;
  precision: 'intervalos_reales';
  reglas_operativas: 'no_configuradas';
  ocupaciones: OcupacionIntervalo[];
  truncado: boolean;
  mensaje: string;
}

/**
 * Both public and private endpoints use the exact same SQL projection, so
 * neither can diverge from the database's half-open conflict constraint.
 */
export async function obtenerDisponibilidad(
  supabase: SupabaseService, unidadId: string,
  desde?: string, hasta?: string, token?: string,
): Promise<DisponibilidadProyeccion> {
  if (!uuid.test(unidadId)) throw new BadRequestException('UUID de unidad inválido');
  if ((desde && !hasta) || (hasta && !desde)) {
    throw new BadRequestException('Se requieren ambos extremos del intervalo');
  }
  const now = new Date();
  const start = desde ? new Date(desde) : now;
  const end = hasta ? new Date(hasta) : new Date(now.getTime() + 60 * 86_400_000);
  if ((desde && !iso.test(desde)) || (hasta && !iso.test(hasta)) ||
      !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      end.getTime() <= start.getTime() ||
      end.getTime() - start.getTime() > 730 * 86_400_000) {
    throw new BadRequestException('Intervalo ISO inválido o mayor que 730 días');
  }
  const { data, error } = await supabase.getClient(token).rpc('disponibilidad_proyeccion', {
    p_unidad: unidadId, p_desde: start.toISOString(), p_hasta: end.toISOString(),
  });
  if (error) throw new ServiceUnavailableException('No se pudo consultar la ocupación real');
  if (!data) throw new NotFoundException('Unidad no publicada o fuera de tu alcance');
  if (!Array.isArray(data.ocupaciones) || typeof data.truncado !== 'boolean') {
    throw new ServiceUnavailableException('Datos de disponibilidad incompletos');
  }
  return data as DisponibilidadProyeccion;
}

export function intersecan(a: OcupacionIntervalo, b: OcupacionIntervalo): boolean {
  return new Date(a.inicio_at).getTime() < new Date(b.fin_at).getTime() &&
    new Date(a.fin_at).getTime() > new Date(b.inicio_at).getTime();
}
