import { addMonths, differenceInCalendarDays, format, isBefore, startOfDay } from 'date-fns';
import type { RentalModality } from '@tfi/types';

export interface TarifaUnidad {
  unidad_tiempo: string;
  cantidad_tiempo?: number;
  precio?: number;
  deleted_at?: string | null;
}

export const rentalModeLabel: Record<RentalModality, string> = {
  por_hora: 'Por hora',
  diaria: 'Por día',
  mensual: 'Mensual',
};

export function normalizeTariffMode(raw: string): RentalModality | null {
  const value = raw.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (['hora', 'horas', 'por_hora', 'hour'].includes(value)) return 'por_hora';
  if (['dia', 'dias', 'diaria', 'day'].includes(value)) return 'diaria';
  if (['mes', 'meses', 'mensual', 'month'].includes(value)) return 'mensual';
  return null;
}

export function getModeTariff(tarifas: TarifaUnidad[] | undefined, mode: RentalModality): number | null {
  // Packages (e.g. 3 days for a special price) are not silently interpreted as
  // a per-day price. Only exact single-unit tariffs can auto-price a contract.
  const one = tarifas?.find((t) => !t.deleted_at &&
    normalizeTariffMode(t.unidad_tiempo) === mode &&
    Number(t.cantidad_tiempo || 1) === 1 &&
    Number.isFinite(Number(t.precio)) && Number(t.precio) > 0);
  return one ? Number(one.precio) : null;
}

export function rentalHours(day: Date, start: string, end: string): number {
  if (!day || !start || !end) return 0;
  const partsStart = start.split(':').map(Number);
  const partsEnd = end.split(':').map(Number);
  if (partsStart.length !== 2 || partsEnd.length !== 2 ||
      ![...partsStart, ...partsEnd].every(Number.isFinite)) return 0;
  const [h1, m1] = partsStart, [h2, m2] = partsEnd;
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59 || h1 < 0 || h2 < 0 || m1 < 0 || m2 < 0) return 0;
  const a = h1 * 60 + m1, b = h2 * 60 + m2;
  return (b <= a ? b + 1440 - a : b - a) / 60;
}

export function rentalMonths(start: Date, end: Date): number {
  if (!start || !end || !isBefore(startOfDay(start), startOfDay(end))) return 0;
  // Count full contractual calendar months (not blocks of 30 days). A
  // fraction of a period is charged as a whole period, never silently prorated.
  let count = 0;
  while (count < 240 && isBefore(addMonths(startOfDay(start), count), startOfDay(end))) count++;
  return count;
}

export function rentalQuantity(
  mode: RentalModality, start: Date, end: Date, startTime: string, endTime: string,
): number {
  if (mode === 'por_hora') return rentalHours(start, startTime, endTime);
  if (!start || !end) return 0;
  if (mode === 'diaria') return Math.max(0, differenceInCalendarDays(end, start));
  return rentalMonths(start, end);
}

export function rentalAmount(quantity: number, rate: number, charges: number, discount: number): number {
  if (![quantity,rate,charges,discount].every((v) => Number.isFinite(v) && v >= 0)) return 0;
  return Math.max(0, Math.round((quantity * rate + charges - discount) * 100) / 100);
}

export function toArgentinaMidnight(day: Date): string {
  const datePart = format(day, 'yyyy-MM-dd');
  return new Date(datePart + 'T03:00:00.000Z').toISOString();
}

export function toArgentinaHourlyInterval(day: Date, start: string, end: string): { inicio: string; fin: string } {
  const ymd = format(day, 'yyyy-MM-dd');
  const dayStart = new Date(ymd + 'T03:00:00.000Z').getTime();
  const minutes = (time: string) => {
    const [hours, mins] = time.split(':').map(Number);
    return hours * 60 + mins;
  };
  const first = minutes(start), last = minutes(end);
  const nextDay = last <= first ? 1440 : 0;
  return {
    inicio: new Date(dayStart + first * 60_000).toISOString(),
    fin: new Date(dayStart + (nextDay + last) * 60_000).toISOString(),
  };
}
