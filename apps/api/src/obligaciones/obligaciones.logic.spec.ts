import { describe, expect, it } from 'vitest';
import { esPeriodoAplicable, resumenUnidad, vencimientoMes } from './obligaciones.logic.js';

const plantilla = {
  id: 'ob-1', nombre: 'Expensas', tipo: 'expensas', frecuencia: 'mensual' as const,
  periodo_inicio: '2026-11-01', dia_vencimiento: 10, responsable: 'propietario',
  moneda: 'ARS', monto_estimado: 15000, activo: true,
};

describe('Gastos de unidad — recurrencia y estados reales', () => {
  it('nunca interpreta una unidad no configurada como al día', () => {
    expect(resumenUnidad([], [], '2026-11', '2026-11-17').estado).toBe('sin_configurar');
  });

  it('pagar noviembre no marca diciembre como pagado ni cancela su vencimiento', () => {
    const paid = [{ obligacion_id: 'ob-1', periodo: '2026-11-01', estado: 'pagado' as const }];
    expect(resumenUnidad([plantilla], paid, '2026-11', '2026-11-17').estado).toBe('al_dia');
    const next = resumenUnidad([plantilla], paid, '2026-12', '2026-12-05');
    expect(next.estado).toBe('pendiente');
    expect(next.pagadas).toBe(0);
    expect(next.pendientes).toBe(1);
  });

  it('una deuda anterior impide mostrar al día aunque el mes actual esté pagado', () => {
    const currentOnly = [{ obligacion_id: 'ob-1', periodo: '2026-12-01', estado: 'pagado' as const }];
    const summary = resumenUnidad([plantilla], currentOnly, '2026-12', '2026-12-14');
    expect(summary.estado).toBe('vencido');
    expect(summary.vencidas).toBe(1);
    expect(summary.pagadas).toBe(1);
  });

  it('calcula vencimiento según el día configurado sin errores de fin de mes', () => {
    expect(vencimientoMes('2027-02', 28)).toBe('2027-02-28');
    expect(vencimientoMes('2027-02', 31)).toBeNull();
  });

  it('bimestral y anual solo vencen en su mes correspondiente', () => {
    const bi = { ...plantilla, frecuencia: 'bimestral' as const };
    const yearly = { ...plantilla, frecuencia: 'anual' as const };
    expect(esPeriodoAplicable(bi, '2026-11')).toBe(true);
    expect(esPeriodoAplicable(bi, '2026-12')).toBe(false);
    expect(esPeriodoAplicable(bi, '2027-01')).toBe(true);
    expect(esPeriodoAplicable(yearly, '2027-10')).toBe(false);
    expect(esPeriodoAplicable(yearly, '2027-11')).toBe(true);
  });

  it('obligación única no se vuelve a cobrar cada mes, pero deja deuda si no se pagó', () => {
    const once = { ...plantilla, frecuencia: 'unica' as const };
    expect(esPeriodoAplicable(once, '2026-12')).toBe(false);
    const later = resumenUnidad([once], [], '2027-01', '2027-01-05');
    expect(later.estado).toBe('vencido');
    expect(later.vencidas).toBe(1);
  });

  it('archivar un concepto lo excluye de nuevos estados sin borrar pagos', () => {
    const archived = { ...plantilla, activo: false };
    expect(resumenUnidad([archived], [], '2026-11', '2026-11-17').estado).toBe('sin_configurar');
  });

  it('no acepta períodos mal formados', () => {
    expect(esPeriodoAplicable(plantilla, '2026-13')).toBe(false);
    expect(esPeriodoAplicable(plantilla, '1999-12')).toBe(false);
  });
});
