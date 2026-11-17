export type FrecuenciaObligacion = 'mensual' | 'bimestral' | 'anual' | 'unica';
export type EstadoObligacion = 'al_dia' | 'pendiente' | 'vencido' | 'sin_vencimientos' | 'sin_configurar';

export interface ObligacionBase {
  id: string;
  nombre: string;
  tipo: string;
  frecuencia: FrecuenciaObligacion;
  periodo_inicio: string;
  dia_vencimiento: number;
  responsable: string;
  monto_estimado: number | null;
  moneda: string;
  activo: boolean;
  notas?: string | null;
}

export interface PeriodoPago {
  id?: string;
  obligacion_id: string;
  periodo: string;
  estado: 'pagado' | 'pendiente';
  monto_pagado?: number | null;
  pagado_at?: string | null;
  notas?: string | null;
}

/** Month is always YYYY-MM (no UTC date parsing for local billing periods). */
export function mesNumero(periodo: string): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return null;
  const year = Number(periodo.slice(0, 4));
  if (year < 2000 || year > 2200) return null;
  return year * 12 + Number(periodo.slice(5, 7)) - 1;
}

export function esPeriodoAplicable(item: Pick<ObligacionBase, 'periodo_inicio' | 'frecuencia' | 'activo'>, periodo: string): boolean {
  if (!item.activo) return false;
  const current = mesNumero(periodo);
  const start = mesNumero(item.periodo_inicio.slice(0, 7));
  if (current === null || start === null || current < start) return false;
  const difference = current - start;
  switch (item.frecuencia) {
    case 'mensual': return true;
    case 'bimestral': return difference % 2 === 0;
    case 'anual': return difference % 12 === 0;
    case 'unica': return difference === 0;
    default: return false;
  }
}

/** Generates a valid date string. Days are limited to 1..28 in storage. */
export function vencimientoMes(periodo: string, dia: number): string | null {
  if (mesNumero(periodo) === null || !Number.isInteger(dia) || dia < 1 || dia > 28) return null;
  return periodo + '-' + String(dia).padStart(2, '0');
}

/** A payment from a different period can never mark the current period as paid. */
export function resumenUnidad(
  obligaciones: ObligacionBase[],
  pagos: PeriodoPago[],
  periodo: string,
  today: string,
): { estado: EstadoObligacion; total: number; pagadas: number; pendientes: number; vencidas: number } {
  const activas = obligaciones.filter(o => o.activo);
  if (activas.length === 0) return { estado: 'sin_configurar', total: 0, pagadas: 0, pendientes: 0, vencidas: 0 };
  const aplicables = activas.filter(o => esPeriodoAplicable(o, periodo));
  const byId = new Map(pagos.filter(p => p.periodo.slice(0, 7) === periodo).map(p => [p.obligacion_id, p]));
  let pagadas = 0, pendientes = 0, vencidas = 0;
  for (const item of aplicables) {
    const pago = byId.get(item.id);
    if (pago?.estado === 'pagado') {
      pagadas++;
    } else if ((vencimientoMes(periodo, item.dia_vencimiento) ?? '9999-12-31') < today) {
      vencidas++;
    } else {
      pendientes++;
    }
  }
  const total = aplicables.length;
  const estado: EstadoObligacion = !total ? 'sin_vencimientos' : vencidas ? 'vencido' : pendientes ? 'pendiente' : 'al_dia';
  return { estado, total, pagadas, pendientes, vencidas };
}
