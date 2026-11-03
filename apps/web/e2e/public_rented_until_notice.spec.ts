import { test, expect } from '@playwright/test';
import { rentedUntilNow, publicRentalEndLabel } from '../src/lib/public-occupancy';

const now = new Date('2026-11-03T05:10:00Z'); // 02:10 ART
const rental = (a: string, b: string) => ({inicio_at:a,fin_at:b});

test.describe('Aviso público alquilada hasta — D1', () => {
  test('alquiler vigente aun sin seña genera aviso hasta la fecha de salida', () => {
    const end = rentedUntilNow([
      rental('2026-11-02T03:00:00Z','2026-11-08T03:00:00Z')
    ],now);
    expect(end?.toISOString()).toBe('2026-11-08T03:00:00.000Z');
    expect(publicRentalEndLabel(end!, 'es')).toContain('8 de noviembre de 2026');
  });
  test('alquiler horario incluye hora Argentina exacta', () => {
    const end=rentedUntilNow([
      rental('2026-11-03T03:00:00Z','2026-11-03T15:30:00Z')
    ],now);
    expect(publicRentalEndLabel(end!, 'es')).toContain('12:30 h');
    expect(publicRentalEndLabel(end!, 'pt')).toContain('12:30 h');
    expect(publicRentalEndLabel(end!, 'en')).toContain('12:30 h');
  });
  test('un alquiler futuro NO muestra actualmente alquilada', () => {
    expect(rentedUntilNow([rental('2026-11-04T03:00:00Z','2026-11-08T03:00:00Z')],now)).toBeNull();
  });
  test('alquiler terminado / extremo [inicio, fin) NO muestra ocupación', () => {
    expect(rentedUntilNow([rental('2026-11-02T03:00:00Z',now.toISOString())],now)).toBeNull();
  });
  test('alquileres adyacentes extienden fecha sin sugerir una liberación falsa', () => {
    const end=rentedUntilNow([
      rental('2026-11-02T03:00:00Z','2026-11-05T03:00:00Z'),
      rental('2026-11-05T03:00:00Z','2026-11-08T03:00:00Z')
    ],now);
    expect(end?.toISOString()).toBe('2026-11-08T03:00:00.000Z');
  });
  test('un intervalo libre entre reservas limita el aviso al primer contrato', () => {
    const end=rentedUntilNow([
      rental('2026-11-02T03:00:00Z','2026-11-05T03:00:00Z'),
      rental('2026-11-05T03:00:01Z','2026-11-08T03:00:00Z')
    ],now);
    expect(end?.toISOString()).toBe('2026-11-05T03:00:00.000Z');
  });
  test('reservas no ordenadas y reservas futuras no anticipan alquilada', () => {
    const end=rentedUntilNow([
      rental('2026-11-08T03:00:00Z','2026-11-10T03:00:00Z'),
      rental('2026-11-02T03:00:00Z','2026-11-05T03:00:00Z'),
    ],now);
    expect(end?.toISOString()).toBe('2026-11-05T03:00:00.000Z');
  });
  test('si la proyección es parcial o inválida, no anunciar un fin incorrecto', () => {
    const records=[rental('2026-11-02T03:00:00Z','2026-11-05T03:00:00Z')];
    expect(rentedUntilNow(records,now,true)).toBeNull();
    expect(rentedUntilNow([rental('bad','2026-11-05T03:00:00Z')],now)).toBeNull();
  });
});
