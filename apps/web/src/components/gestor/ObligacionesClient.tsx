'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CalendarDays, CheckCircle2, CircleDollarSign,
  Pencil, Plus, RotateCcw, Save, ShieldCheck, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type EstadoResumen = 'sin_configurar' | 'sin_vencimientos' | 'al_dia' | 'pendiente' | 'vencido';
export interface Obligacion {
  id: string;
  nombre: string;
  tipo: string;
  frecuencia: string;
  periodo_inicio: string;
  dia_vencimiento: number;
  responsable: string;
  monto_estimado: number | null;
  moneda: 'ARS' | 'UYU' | 'USD';
  notas: string | null;
  activo: boolean;
}
export interface PagoPeriodo {
  id: string;
  obligacion_id: string;
  periodo: string;
  estado: 'pagado' | 'pendiente';
  monto_pagado: number | null;
  pagado_at: string | null;
  notas: string | null;
}
export interface DatosObligaciones {
  periodo: string;
  hoy: string;
  obligaciones: Obligacion[];
  periodos: PagoPeriodo[];
  resumen: { estado: EstadoResumen; total: number; pagadas: number; pendientes: number; vencidas: number };
}

const tipos = [
  ['expensas', 'Expensas'], ['inmobiliario', 'Impuesto inmobiliario'],
  ['municipal', 'Tasa municipal'], ['luz', 'Electricidad'],
  ['agua', 'Agua'], ['gas', 'Gas'], ['mantenimiento', 'Mantenimiento'], ['otro', 'Otro gasto'],
];
const frecuencias = [
  ['mensual', 'Mensual'], ['bimestral', 'Bimestral'], ['anual', 'Anual'], ['unica', 'Una sola vez'],
];
const responsables = [
  ['propietario', 'Propietario'], ['inquilino', 'Inquilino'], ['gestor', 'Gestor'], ['otro', 'Otro'],
];
const estados: Record<EstadoResumen, string> = {
  sin_configurar: 'Sin obligaciones configuradas',
  sin_vencimientos: 'Sin vencimientos en este período',
  al_dia: 'Al día según tus registros',
  pendiente: 'Hay pagos pendientes',
  vencido: 'Hay gastos vencidos',
};
const estadoClass: Record<EstadoResumen, string> = {
  sin_configurar: 'border-border text-muted-foreground bg-muted',
  sin_vencimientos: 'border-border text-muted-foreground bg-muted',
  al_dia: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  pendiente: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  vencido: 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300',
};

type FormData = {
  nombre: string; tipo: string; frecuencia: string; periodo_inicio: string;
  dia_vencimiento: string; responsable: string; monto_estimado: string;
  moneda: string; notas: string;
};
const newForm = (periodo: string): FormData => ({
  nombre: 'Expensas', tipo: 'expensas', frecuencia: 'mensual', periodo_inicio: periodo,
  dia_vencimiento: '10', responsable: 'propietario', monto_estimado: '',
  moneda: 'ARS', notas: '',
});
function correspondiente(item: Obligacion, periodo: string) {
  if (!item.activo) return false;
  const start = item.periodo_inicio.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || periodo < start) return false;
  const n = (Number(periodo.slice(0, 4)) - Number(start.slice(0, 4))) * 12
    + Number(periodo.slice(5, 7)) - Number(start.slice(5, 7));
  return item.frecuencia === 'mensual' ||
    (item.frecuencia === 'bimestral' && n % 2 === 0) ||
    (item.frecuencia === 'anual' && n % 12 === 0) ||
    (item.frecuencia === 'unica' && n === 0);
}
function formatMoney(value: number | null, currency: string) {
  if (value === null || value === undefined) return 'Sin importe definido';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export default function ObligacionesClient({
  unidadId, nombreUnidad, locale, token, canEdit, initialData,
}: {
  unidadId: string;
  nombreUnidad: string;
  locale: string;
  token: string;
  canEdit: boolean;
  initialData: DatosObligaciones;
}) {
  const [periodo, setPeriodo] = useState(initialData.periodo);
  const [data, setData] = useState<DatosObligaciones>(initialData);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(newForm(initialData.periodo));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const requestSerial = useRef(0);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
  const endpoint = apiBase + '/unidades/' + encodeURIComponent(unidadId) + '/obligaciones';

  const call = useCallback(async (path: string, options?: RequestInit) => {
    const response = await fetch(endpoint + path, {
      ...options,
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const value = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
      throw new Error(typeof value === 'string' ? value : 'No se pudo completar la operación');
    }
    return response.json();
  }, [endpoint, token]);

  const reload = useCallback(async (month: string) => {
    const serial = ++requestSerial.current;
    setLoading(true);
    try {
      const fresh = await call('?periodo=' + encodeURIComponent(month)) as DatosObligaciones;
      if (serial !== requestSerial.current) return false;
      if (fresh.periodo !== month) throw new Error('La API devolvió un período diferente');
      setData(fresh);
      setError(null);
      return true;
    } catch (err) {
      if (serial === requestSerial.current) setError(err instanceof Error ? err.message : 'No se pudieron cargar los gastos');
      return false;
    } finally {
      if (serial === requestSerial.current) setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    if (periodo !== data.periodo) void reload(periodo);
  }, [periodo, data.periodo, reload]);

  const mutate = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await work();
      const refreshed = await reload(periodo);
      if (!refreshed) throw new Error('Se guardó el cambio, pero no se pudo actualizar la información. Recargá la página.');
      setNotice(success);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item?: Obligacion) => {
    setEditing(item?.id || null);
    setForm(item ? {
      nombre: item.nombre,
      tipo: item.tipo,
      frecuencia: item.frecuencia,
      periodo_inicio: item.periodo_inicio.slice(0, 7),
      dia_vencimiento: String(item.dia_vencimiento),
      responsable: item.responsable,
      monto_estimado: item.monto_estimado === null ? '' : String(item.monto_estimado),
      moneda: item.moneda,
      notas: item.notas || '',
    } : newForm(periodo));
    setFormVisible(true);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!form.nombre.trim()) { setError('Ingresá el nombre del gasto.'); return; }
    const payload = {
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      frecuencia: form.frecuencia,
      periodo_inicio: form.periodo_inicio,
      dia_vencimiento: Number(form.dia_vencimiento),
      responsable: form.responsable,
      monto_estimado: form.monto_estimado === '' ? null : Number(form.monto_estimado),
      moneda: form.moneda,
      notas: form.notas.trim() || null,
    };
    const ok = await mutate(() => call(editing ? '/' + editing : '', {
      method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload),
    }), editing ? 'Obligación actualizada' : 'Gasto agregado a la unidad');
    if (ok) { setFormVisible(false); setEditing(null); }
  };

  const mark = async (item: Obligacion, pago: PagoPeriodo | undefined) => {
    if (!canEdit || busy) return;
    const pagado = pago?.estado === 'pagado';
    const parsed = amounts[item.id]?.trim();
    const amount = parsed ? Number(parsed) : undefined;
    if (parsed && (!Number.isFinite(amount) || amount! < 0)) {
      setError('El importe abonado debe ser un número válido.');
      return;
    }
    await mutate(() => call('/' + item.id + '/periodos', {
      method: 'POST',
      body: JSON.stringify({
        periodo, estado: pagado ? 'pendiente' : 'pagado',
        ...(!pagado && amount !== undefined ? { monto_pagado: amount } : {}),
      }),
    }), pagado ? 'Pago vuelto a marcar como pendiente' : 'Pago registrado');
  };

  const resumen = data.resumen;
  const readyForPeriod = data.periodo === periodo && !loading;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6">
      <Link href={'/' + locale + '/mis-unidades'} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Volver a mis unidades
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <CircleDollarSign className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-2xl sm:text-3xl font-bold">Gastos y obligaciones</h1>
        </div>
        <p className="text-sm text-muted-foreground">{nombreUnidad}</p>
        <p className="text-xs text-muted-foreground">Control privado y manual de impuestos, expensas, servicios y otros gastos. No modifica cobros de alquiler ni el estado de publicación de la unidad.</p>
      </header>

      <section className="rounded-2xl border bg-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label htmlFor="expense-month" className="text-sm font-medium flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Período de consulta
          </label>
          <Input id="expense-month" type="month" className="w-auto min-h-[44px]" value={periodo}
            min="2000-01" max="2200-12" onChange={e => setPeriodo(e.target.value)} />
        </div>
        <div aria-live="polite" className={'rounded-xl border p-4 space-y-1 ' + (readyForPeriod ? estadoClass[resumen.estado] : 'bg-muted border-border text-muted-foreground')}>
          {readyForPeriod ? (
            <>
              <p className="font-semibold text-sm">{estados[resumen.estado]}</p>
              <p className="text-xs">{resumen.pagadas} pagadas · {resumen.pendientes} pendientes · {resumen.vencidas} vencidas</p>
            </>
          ) : <p className="text-sm font-medium">Consultando el período seleccionado…</p>}
        </div>
        <p className="text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 inline mr-1" />
          «Al día» solo refleja los pagos que registraste en Rendo: no verifica deudas con organismos o proveedores.
        </p>
      </section>

      {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive p-3 text-sm">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Conceptos de la unidad</h2>
        {canEdit && <Button onClick={() => formVisible ? setFormVisible(false) : startEdit()} disabled={busy} className="min-h-[44px]">
          {formVisible ? <X className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
          {formVisible ? 'Cancelar' : 'Agregar gasto'}
        </Button>}
      </div>

      {formVisible && canEdit && (
        <form onSubmit={submit} className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4" aria-label="Configurar gasto">
          <h3 className="font-semibold">{editing ? 'Editar gasto' : 'Nuevo concepto de gasto'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-sm space-y-1">Concepto
              <select className="w-full min-h-[44px] rounded-lg border border-input bg-background px-3" value={form.tipo}
                onChange={e => setForm(s => ({ ...s, tipo: e.target.value, nombre: tipos.find(t => t[0] === e.target.value)?.[1] || s.nombre }))}>
                {tipos.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm space-y-1">Nombre
              <Input required maxLength={100} value={form.nombre} onChange={e => setForm(s => ({ ...s, nombre: e.target.value }))} className="min-h-[44px]" />
            </label>
            <label className="text-sm space-y-1">Frecuencia
              <select className="w-full min-h-[44px] rounded-lg border border-input bg-background px-3" value={form.frecuencia}
                onChange={e => setForm(s => ({ ...s, frecuencia: e.target.value }))}>
                {frecuencias.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm space-y-1">Primer período
              <Input type="month" required min="2000-01" max="2200-12" value={form.periodo_inicio}
                onChange={e => setForm(s => ({ ...s, periodo_inicio: e.target.value }))} className="min-h-[44px]" />
            </label>
            <label className="text-sm space-y-1">Día de vencimiento (1–28)
              <Input type="number" required min={1} max={28} value={form.dia_vencimiento}
                onChange={e => setForm(s => ({ ...s, dia_vencimiento: e.target.value }))} className="min-h-[44px]" />
            </label>
            <label className="text-sm space-y-1">Responsable del pago
              <select className="w-full min-h-[44px] rounded-lg border border-input bg-background px-3" value={form.responsable}
                onChange={e => setForm(s => ({ ...s, responsable: e.target.value }))}>
                {responsables.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm space-y-1">Importe estimado (opcional)
              <Input type="number" min={0} step="0.01" value={form.monto_estimado} placeholder="Sin importe"
                onChange={e => setForm(s => ({ ...s, monto_estimado: e.target.value }))} className="min-h-[44px]" />
            </label>
            <label className="text-sm space-y-1">Moneda
              <select className="w-full min-h-[44px] rounded-lg border border-input bg-background px-3" value={form.moneda}
                onChange={e => setForm(s => ({ ...s, moneda: e.target.value }))}>
                <option value="ARS">ARS · Peso argentino</option><option value="UYU">UYU · Peso uruguayo</option><option value="USD">USD · Dólar</option>
              </select>
            </label>
          </div>
          <label className="block text-sm space-y-1">Observaciones (opcional)
            <textarea className="w-full min-h-[76px] rounded-lg border border-input bg-background p-3"
              maxLength={500} value={form.notas} onChange={e => setForm(s => ({ ...s, notas: e.target.value }))} />
          </label>
          <Button type="submit" disabled={busy || loading} className="min-h-[44px]">
            <Save className="h-4 w-4 mr-2" /> {busy ? 'Guardando…' : 'Guardar concepto'}
          </Button>
        </form>
      )}

      <section className="space-y-3" aria-label="Gastos configurados" aria-busy={loading || busy}>
        {loading && <p className="text-sm text-muted-foreground">Actualizando período…</p>}
        {readyForPeriod && !data.obligaciones.length && <div className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground text-sm">
          Todavía no hay gastos configurados. Agregá expensas, impuestos o servicios para empezar a controlarlos.
        </div>}
        {readyForPeriod && data.obligaciones.map(item => {
          const applies = correspondiente(item, periodo);
          const pago = data.periodos.find(p => p.obligacion_id === item.id && p.periodo.slice(0,7) === periodo);
          const paid = applies && pago?.estado === 'pagado';
          const due = periodo + '-' + String(item.dia_vencimiento).padStart(2, '0');
          const overdue = applies && !paid && due < data.hoy;
          return (
            <article key={item.id} className="rounded-2xl border bg-card p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <h3 className="font-semibold text-base">{item.nombre}</h3>
                  <p className="text-xs text-muted-foreground">
                    {frecuencias.find(v => v[0] === item.frecuencia)?.[1]} · {responsables.find(v => v[0] === item.responsable)?.[1]}
                    {' · '}Vence el día {item.dia_vencimiento}
                  </p>
                  <p className="text-sm text-muted-foreground">{formatMoney(item.monto_estimado, item.moneda)} estimado</p>
                </div>
                <span className={'rounded-full px-3 py-1 text-xs border ' + (
                  !item.activo || !applies ? 'border-border bg-muted text-muted-foreground' :
                  paid ? estadoClass.al_dia : overdue ? estadoClass.vencido : estadoClass.pendiente
                )}>
                  {!item.activo ? 'Archivada' : !applies ? 'No corresponde al mes' : paid ? 'Pagada' : overdue ? 'Vencida' : 'Pendiente'}
                </span>
              </div>
              {applies && canEdit && (
                <div className="flex flex-wrap items-end gap-3">
                  {!paid && <label className="text-xs space-y-1">
                    Importe abonado (opcional)
                    <Input type="number" min={0} step="0.01" className="w-44 min-h-[44px]"
                      placeholder="Importe real" value={amounts[item.id] ?? ''}
                      onChange={e => setAmounts(s => ({ ...s, [item.id]: e.target.value }))} />
                  </label>}
                  <Button type="button" disabled={busy || loading} variant={paid ? 'outline' : 'default'}
                    className="min-h-[44px]" onClick={() => void mark(item,pago)}>
                    {paid ? <RotateCcw className="h-4 w-4 mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    {paid ? 'Volver a pendiente' : 'Marcar como pagada'}
                  </Button>
                </div>
              )}
              {paid && pago?.monto_pagado !== null && pago?.monto_pagado !== undefined && (
                <p className="text-xs text-muted-foreground">Importe registrado: {formatMoney(pago.monto_pagado,item.moneda)}</p>
              )}
              {canEdit && item.activo && (
                <div className="flex flex-wrap items-center gap-3 border-t pt-2">
                  <button type="button" onClick={() => startEdit(item)}
                    className="inline-flex min-h-[44px] items-center gap-2 text-sm text-primary hover:underline">
                    <Pencil className="h-4 w-4" /> Editar
                  </button>
                  <button type="button" disabled={busy} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => void mutate(() => call('/' + item.id, {
                      method: 'PATCH', body: JSON.stringify({ activo: false }),
                    }), 'Obligación archivada. Se conserva su historial.')}>Archivar concepto</button>
                </div>
              )}
              <details className="text-xs text-muted-foreground border-t pt-2">
                <summary className="cursor-pointer min-h-[40px] inline-flex items-center">Ver historial de pagos registrados</summary>
                <ul className="space-y-1 py-2">
                  {data.periodos.filter(p => p.obligacion_id === item.id).length ? data.periodos
                    .filter(p => p.obligacion_id === item.id)
                    .map(p => <li key={p.id}>{p.periodo.slice(0,7)}: {p.estado === 'pagado' ? 'Pagada' : 'Pendiente'}{p.monto_pagado !== null ? ' · ' + formatMoney(p.monto_pagado,item.moneda) : ''}</li>) :
                    <li>Todavía no hay pagos marcados para este concepto.</li>}
                </ul>
              </details>
            </article>
          );
        })}
      </section>
    </main>
  );
}
