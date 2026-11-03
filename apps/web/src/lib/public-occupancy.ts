/**
 * Rendo - proyección informativa de la ocupación pública.
 *
 * Una reserva registrada ocupa su rango exacto [inicio_at, fin_at), independientemente
 * de pagos, señas y estado de publicación. Estas funciones son SOLO de presentación:
 * PostgreSQL conserva la autoridad para determinar conflictos.
 */
export interface PublicOccupancyPeriod {
  inicio_at: string;
  fin_at: string;
}

/**
 * Entrega el fin de la ocupación vigente, integrando alquileres consecutivos
 * sin intervalo libre. Las reservas futuras no cambian el aviso "alquilada ahora".
 * No afirma un fin si los datos están incompletos o son inválidos.
 */
export function rentedUntilNow(
  periods: PublicOccupancyPeriod[],
  now: Date,
  truncated = false,
): Date | null {
  if (truncated || !Number.isFinite(now.getTime())) return null;
  const parsed = periods.map((p) => ({
    start: Date.parse(p.inicio_at),
    end: Date.parse(p.fin_at),
  }));
  if (parsed.some((p) => !Number.isFinite(p.start) ||
    !Number.isFinite(p.end) || p.end <= p.start)) return null;

  parsed.sort((a, b) => a.start - b.start || a.end - b.end);
  const at = now.getTime();
  let occupiedUntil: number | null = null;
  for (const p of parsed) {
    if (occupiedUntil === null) {
      if (p.start <= at && at < p.end) occupiedUntil = p.end;
    } else if (p.start <= occupiedUntil && p.end > occupiedUntil) {
      occupiedUntil = p.end;
    } else if (p.start > occupiedUntil) {
      break; // No anunciar una reserva posterior como ocupación continua.
    }
  }
  return occupiedUntil === null ? null : new Date(occupiedUntil);
}

export function publicRentalEndLabel(end: Date, locale: string): string {
  const culture = locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : 'es-AR';
  const timeZone = 'America/Argentina/Buenos_Aires';
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).format(end);
  const date = new Intl.DateTimeFormat(culture, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone,
  }).format(end);
  // Local midnight is the checkout/end date. For hourly or non-midnight
  // contracts include local time so clients do not assume a full day is free.
  return hhmm === '00:00' ? date : date + ', ' + hhmm + ' h';
}
