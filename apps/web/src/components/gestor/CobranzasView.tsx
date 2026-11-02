'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CalendarClock, CheckCircle2, CircleAlert, HandCoins, History, ReceiptText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getClientAuthToken } from '@/lib/supabase/client-token';

type Estado = 'pagada' | 'vencida' | 'parcial' | 'pendiente';
type Movimiento = {
  id: string; importe: number; tipo: 'apertura' | 'cobro';
  medio: string | null; fecha_pago: string | null; referencia: string | null;
  anulado_at: string | null; motivo_anulacion: string | null; created_at: string;
};
export type Cuota = {
  id: string; alquiler_id: string; numero: number; periodo_inicio: string;
  vencimiento: string; monto: number; pagado: number; saldo: number; estado: Estado;
  alquiler?: { id: string; modalidad: string; unidad?: {titulo_es?: string} | null;
    inquilino?: {nombre_completo?: string} | null} | null;
  pagos: Movimiento[];
};
export type AlquilerDisponible = {
  id: string; estado: string; modalidad: string;
  unidad?: {titulo_es?: string} | null;
  inquilino?: {nombre_completo?: string} | null;
};
export interface CobranzasViewProps {
  cuotas: Cuota[];
  totalCuotas: number;
  alquileres: AlquilerDisponible[];
  token: string;
  canManage: boolean;
}

const dinero = (amount: number) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', maximumFractionDigits: 2,
}).format(amount || 0);
const fecha = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR').format(new Date(y, m - 1, d));
};
const hoyArgentina = () => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return get('year') + '-' + get('month') + '-' + get('day');
};
const estadoLabel: Record<Estado, string> = {
  pagada: 'Pagada', vencida: 'Vencida', parcial: 'Pago parcial', pendiente: 'Pendiente',
};
const badgeStyle: Record<Estado, string> = {
  pagada: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  vencida: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  parcial: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  pendiente: 'border-border bg-muted/70 text-foreground',
};

export function CobranzasView({cuotas, totalCuotas, alquileres, token, canManage}: CobranzasViewProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<'todos' | Estado>('todos');
  const [chosenRental, setChosenRental] = useState('');
  const [selectedCuota, setSelectedCuota] = useState<Cuota | null>(null);
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(hoyArgentina);
  const [method, setMethod] = useState('transferencia');
  const [reference, setReference] = useState('');
  const [reversing, setReversing] = useState<Movimiento | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const alreadyPlanned = useMemo(() => new Set(cuotas.map(q => q.alquiler_id)), [cuotas]);
  const missingPlans = alquileres.filter(a => a.estado !== 'cancelado' && !alreadyPlanned.has(a.id));
  const visible = cuotas.filter(q => filter === 'todos' || q.estado === filter);
  const sum = cuotas.reduce((acc, q) => {
    acc.total += q.monto;
    acc.paid += q.pagado;
    acc.due += q.saldo;
    if (q.estado === 'vencida') acc.late += q.saldo;
    return acc;
  }, {total: 0, paid: 0, due: 0, late: 0});
  const newestReceipts = cuotas.flatMap(q => q.pagos.filter(p => p.tipo === 'cobro' && !p.anulado_at)
    .map(p => ({...p, cuotaId: q.id})))
    .sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,6);

  async function send(url: string, body?: unknown) {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch((process.env.NEXT_PUBLIC_API_URL || '') + url, {
        method: 'POST', cache: 'no-store',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + getClientAuthToken(token)},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = Array.isArray(data.message) ? data.message.join(' · ') : data.message;
        throw new Error(String(message || 'No se pudo completar la operación'));
      }
      setSelectedCuota(null);
      setReversing(null);
      setReason('');
      setAmount('');
      setSuccess('Operación registrada correctamente. Se actualizaron los saldos.');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }

  async function registerPayment() {
    if (!selectedCuota) return;
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0 || val > selectedCuota.saldo ||
        Math.abs(val * 100 - Math.round(val * 100)) > 0.000001) {
      setError('El importe debe tener hasta dos decimales y no exceder el saldo de la cuota.');
      return;
    }
    await send('/cobranzas/cuotas/' + selectedCuota.id + '/pagos', {
      importe: val, fecha_pago: payDate, medio: method, referencia: reference.trim(),
    });
  }

  return (
    <div className="space-y-6" data-testid="cobranzas-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-mono uppercase tracking-wider text-primary">Gestión inmobiliaria</p>
          <h1 className="text-3xl font-bold tracking-tight">Cobros y deudas</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
            Cuotas, pagos parciales y saldos reales. Las garantías en custodia no forman parte de estos importes.
            Los cobros de apertura son pagos previamente registrados, no nuevos ingresos.
          </p>
        </div>
        <span className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs font-mono">
          {totalCuotas} cuotas emitidas
        </span>
      </header>

      {error && <div role="alert" data-testid="cobranzas-error"
        className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
      {success && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">{success}</div>}
      {totalCuotas > cuotas.length && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
        Mostrando las primeras {cuotas.length} de {totalCuotas} cuotas autorizadas. Los indicadores se calculan solo sobre las cuotas cargadas.
      </p>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {([
          ['Total contratado en cuotas', sum.total, Banknote, 'text-foreground'],
          ['Total abonado', sum.paid, CheckCircle2, 'text-emerald-600 dark:text-emerald-400'],
          ['Saldo por cobrar', sum.due, HandCoins, 'text-foreground'],
          ['Deuda vencida', sum.late, CircleAlert, 'text-red-600 dark:text-red-400'],
        ] as const).map(([label, value, Icon, color]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-muted-foreground font-medium leading-snug">{label}</p>
              <Icon className={'h-4 w-4 shrink-0 ' + color} aria-hidden="true"/>
            </div>
            <p className={'text-lg sm:text-xl font-bold tabular-nums tracking-tight ' + color}>{dinero(value)}</p>
          </div>
        ))}
      </div>

      {canManage && <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary"/>
          <h2 className="font-bold text-lg">Generar plan de cuotas</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Seleccioná un alquiler registrado. Mensual: cuotas por período calendario. Por día/hora: una cuota.
          Los anticipos del contrato se importan como apertura; no se cobran dos veces.
        </p>
        {missingPlans.length === 0 ? <p className="rounded-lg bg-muted/30 p-3 text-sm">
          No hay alquileres pendientes de generar entre los contratos cargados.
        </p> : <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="cobranzas-alquiler">Alquiler</Label>
            <select id="cobranzas-alquiler" data-testid="cobranzas-alquiler-select"
              className="w-full min-h-11 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={chosenRental} onChange={e => setChosenRental(e.target.value)}>
              <option value="">Elegí un contrato…</option>
              {missingPlans.map(a => <option value={a.id} key={a.id}>
                {(a.unidad?.titulo_es || 'Unidad') + ' · ' + (a.inquilino?.nombre_completo || 'Inquilino') +
                  ' · ' + a.modalidad}
              </option>)}
            </select>
          </div>
          <Button type="button" className="min-h-11" disabled={!chosenRental || loading}
            onClick={() => send('/cobranzas/alquileres/' + chosenRental + '/generar')}>
            {loading ? 'Procesando…' : 'Generar cuotas'}
          </Button>
        </div>}
      </section>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Cuenta corriente</h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar cuotas">
            {(['todos','pendiente','parcial','vencida','pagada'] as const).map(option => (
              <Button key={option} type="button" size="sm" variant={filter === option ? 'default' : 'outline'}
                aria-pressed={filter === option} onClick={() => setFilter(option)}
                className="min-h-9 capitalize">
                {option === 'todos' ? 'Todas' : estadoLabel[option]}
              </Button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <ReceiptText className="mx-auto h-10 w-10 text-muted-foreground mb-3"/>
          <p className="text-base font-semibold">No hay cuotas en esta vista</p>
          <p className="text-sm text-muted-foreground mt-2">
            {cuotas.length === 0 ? 'Generá un plan desde un alquiler para comenzar a registrar cobros.'
              : 'Probá con otro filtro de estado.'}
          </p>
        </div> : <div className="grid gap-3">
          {visible.map(q => <article key={q.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="cobranzas-cuota">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold">{q.alquiler?.unidad?.titulo_es || 'Unidad'} · Cuota {q.numero}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {q.alquiler?.inquilino?.nombre_completo || 'Inquilino'} · Vence {fecha(q.vencimiento)} ·
                  {' '}Modalidad {q.alquiler?.modalidad || 'alquiler'}
                </p>
              </div>
              <span className={'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ' + badgeStyle[q.estado]}>
                {estadoLabel[q.estado]}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/25 p-3 text-center sm:text-left">
              <div><p className="text-[11px] text-muted-foreground">Contratado</p>
                <p className="font-semibold tabular-nums text-xs sm:text-base">{dinero(q.monto)}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Pagado</p>
                <p className="font-semibold tabular-nums text-xs sm:text-base text-emerald-700 dark:text-emerald-400">{dinero(q.pagado)}</p></div>
              <div><p className="text-[11px] text-muted-foreground">Pendiente</p>
                <p className="font-bold tabular-nums text-xs sm:text-base">{dinero(q.saldo)}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <details className="text-sm min-w-0 flex-1">
                <summary className="cursor-pointer font-semibold text-xs text-primary focus-visible:outline-primary">
                  Ver movimientos ({q.pagos.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {q.pagos.length === 0 && <p className="text-xs text-muted-foreground">Todavía no hay cobros.</p>}
                  {q.pagos.map(p => <div key={p.id}
                    className="flex flex-wrap justify-between gap-2 rounded-lg border border-border bg-background p-3 text-xs">
                    <div>
                      <p className={'font-semibold ' + (p.anulado_at ? 'line-through text-muted-foreground' : '')}>
                        {dinero(p.importe)} · {p.tipo === 'apertura' ? 'Saldo inicial importado' : p.medio}
                      </p>
                      <p className="text-muted-foreground mt-1">
                        {p.tipo === 'apertura' ? 'Cobro previo al plan · fecha original no disponible'
                          : p.fecha_pago ? 'Fecha de cobro: ' + fecha(p.fecha_pago) : ''}
                        {p.referencia ? ' · ' + p.referencia : ''}
                      </p>
                      {p.anulado_at && <p className="text-red-600 dark:text-red-400 mt-1">
                        Anulado: {p.motivo_anulacion || 'Sin motivo'}
                      </p>}
                    </div>
                    {canManage && p.tipo === 'cobro' && !p.anulado_at &&
                      <Button size="sm" variant="outline" type="button" disabled={loading}
                        onClick={() => {setReversing(p);setSelectedCuota(null);setError('');}}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1"/> Anular
                      </Button>}
                  </div>)}
                </div>
              </details>
              {canManage && q.saldo > 0 && <Button size="sm" type="button"
                onClick={() => {setSelectedCuota(q); setReversing(null);setAmount(q.saldo.toFixed(2));setError('');}}>
                <HandCoins className="h-4 w-4 mr-1.5"/> Registrar cobro
              </Button>}
            </div>
          </article>)}
        </div>}
      </section>

      {canManage && selectedCuota && <section className="rounded-2xl border-2 border-primary/30 bg-card p-4 sm:p-6 space-y-4" data-testid="cobranzas-pago-form">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Registrar cobro · Cuota {selectedCuota.numero}</h2>
          <Button variant="ghost" type="button" size="sm" onClick={() => setSelectedCuota(null)}>Cerrar</Button>
        </div>
        <p className="text-xs text-muted-foreground">Saldo disponible: <strong>{dinero(selectedCuota.saldo)}</strong>.
          Solo registrá pagos efectivamente recibidos. No se ejecutan transferencias desde Rendo.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cobranzas-importe">Importe cobrado (ARS) *</Label>
            <Input id="cobranzas-importe" type="number" min="0.01"
              max={selectedCuota.saldo} step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)} className="min-h-11"/>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cobranzas-fecha">Fecha real del pago *</Label>
            <Input id="cobranzas-fecha" type="date" max={hoyArgentina()}
              value={payDate} onChange={e => setPayDate(e.target.value)} className="min-h-11"/>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cobranzas-medio">Medio *</Label>
            <select id="cobranzas-medio" value={method} onChange={e => setMethod(e.target.value)}
              className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-sm">
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="mercadopago">Mercado Pago (registrado manualmente)</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cobranzas-referencia">Referencia o comprobante (opcional)</Label>
          <Input id="cobranzas-referencia" maxLength={160} value={reference} className="min-h-11"
            onChange={e => setReference(e.target.value)} placeholder="Identificador, comprobante o nota de referencia"/>
        </div>
        <Button disabled={loading || !amount || !payDate} onClick={registerPayment}>
          {loading ? 'Registrando…' : 'Guardar cobro'}
        </Button>
      </section>}

      {canManage && reversing && <section className="rounded-2xl border border-red-500/30 bg-card p-4 sm:p-5 space-y-3">
        <h2 className="font-bold text-base">Anular cobro de {dinero(reversing.importe)}</h2>
        <p className="text-xs text-muted-foreground">
          La anulación restituirá el saldo de la cuota. El movimiento seguirá visible como evidencia.
        </p>
        <Label htmlFor="cobranzas-motivo">Motivo obligatorio (mínimo 8 caracteres)</Label>
        <Input id="cobranzas-motivo" value={reason} maxLength={500}
          onChange={e => setReason(e.target.value)} placeholder="Ej.: Cobro duplicado registrado por error"/>
        <div className="flex gap-2">
          <Button variant="destructive" disabled={loading || reason.trim().length < 8}
            onClick={() => send('/cobranzas/pagos/' + reversing.id + '/anular', { motivo: reason })}>
            Confirmar anulación
          </Button>
          <Button variant="outline" onClick={() => {setReversing(null);setReason('');}}>Cancelar</Button>
        </div>
      </section>}

      {newestReceipts.length > 0 && <section className="space-y-2">
        <h2 className="text-lg font-bold flex items-center gap-2"><History className="h-5 w-5 text-primary"/> Cobros recientes</h2>
        <div className="rounded-xl border border-border divide-y divide-border bg-card">
          {newestReceipts.map(p => <div key={p.id} className="flex items-center justify-between p-3 text-xs">
            <span>{p.fecha_pago ? fecha(p.fecha_pago) : 'Fecha no disponible'} · {p.medio}</span>
            <strong className="font-mono">{dinero(p.importe)}</strong>
          </div>)}
        </div>
        <p className="text-xs text-muted-foreground">Movimientos manuales vigentes; no incluye saldos iniciales importados.</p>
      </section>}
    </div>
  );
}
