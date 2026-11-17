'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, Building2, CalendarDays, CheckCircle2, CircleDollarSign,
  Filter, Info, Plus, ReceiptText, Search, WalletCards,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button';

export type EstadoResumen = 'sin_configurar' | 'sin_vencimientos' | 'al_dia' | 'pendiente' | 'vencido';
export type EstadoConcepto = 'pagado' | 'pendiente' | 'vencido' | 'sin_vencimiento';

export interface ConceptoPanel {
  id: string;
  nombre: string;
  tipo: string;
  frecuencia: string;
  responsable: string;
  moneda: string;
  monto_estimado: number | null;
  monto_pagado: number | null;
  estado: EstadoConcepto;
  vencimiento: string | null;
  periodos_vencidos: number;
}
export interface PanelUnidad {
  estado: EstadoResumen;
  total: number;
  pagadas: number;
  pendientes: number;
  vencidas: number;
  conceptos: ConceptoPanel[];
}
export interface PanelUnidadListado {
  id: string;
  nombre: string;
  grupo: string | null;
  categoria: string | null;
  resumen: PanelUnidad | null;
}

const statusLabel: Record<EstadoResumen, string> = {
  vencido: 'Con vencimientos',
  pendiente: 'Pendientes',
  al_dia: 'Al día',
  sin_vencimientos: 'Sin vencimientos este mes',
  sin_configurar: 'Sin configurar',
};
const conceptLabel: Record<EstadoConcepto, string> = {
  vencido: 'Vencido', pendiente: 'Pendiente', pagado: 'Pagado', sin_vencimiento: 'No corresponde a este mes',
};
const statusClass: Record<EstadoResumen, string> = {
  vencido: 'bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300',
  pendiente: 'bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300',
  al_dia: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  sin_vencimientos: 'bg-muted text-muted-foreground border-border',
  sin_configurar: 'bg-muted text-muted-foreground border-border',
};
const conceptClass: Record<EstadoConcepto, string> = {
  vencido: 'bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300',
  pendiente: 'bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300',
  pagado: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  sin_vencimiento: 'bg-muted text-muted-foreground border-border',
};
const tipos: Record<string, string> = {
  expensas: 'Expensas', inmobiliario: 'Impuesto inmobiliario', municipal: 'Tasa municipal',
  luz: 'Electricidad', agua: 'Agua', gas: 'Gas', mantenimiento: 'Mantenimiento', otro: 'Otro gasto',
};
const frecuencia: Record<string, string> = {
  mensual: 'Mensual', bimestral: 'Bimestral', anual: 'Anual', unica: 'Único',
};
const responsable: Record<string, string> = {
  propietario: 'Propietario', inquilino: 'Inquilino', gestor: 'Gestor', otro: 'Otro',
};
const statusRank: Record<EstadoResumen, number> = {
  vencido: 0, pendiente: 1, al_dia: 2, sin_vencimientos: 3, sin_configurar: 4,
};

function normalize(value: string): string {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function formatMoney(amount: number | null, currency: string) {
  if (amount === null || !Number.isFinite(Number(amount))) return 'Sin monto estimado';
  if (!['ARS', 'UYU', 'USD'].includes(currency)) return String(amount) + ' ' + currency;
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
}
function readableMonth(month: string) {
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(month + '-01T12:00:00Z'));
}
function readableDue(due: string | null) {
  if (!due) return null;
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(due + 'T12:00:00Z'));
}
function unitExpenseLink(locale: string, unitId: string, periodo: string) {
  return '/' + locale + '/mis-unidades/' + unitId + '/obligaciones?periodo=' + encodeURIComponent(periodo);
}
function pageLink(locale: string, periodo: string, page: number) {
  return '/' + locale + '/gastos?periodo=' + encodeURIComponent(periodo) + '&page=' + page;
}

export default function GastosOverview({
  locale, periodo, unidades, page, totalUnidades, perPage, canManage,
}: {
  locale: string;
  periodo: string;
  unidades: PanelUnidadListado[];
  page: number;
  totalUnidades: number;
  perPage: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [loading, startTransition] = useTransition();
  const [monthInput, setMonthInput] = useState(periodo);
  const [unidadFilter, setUnidadFilter] = useState('todas');
  const [estadoFilter, setEstadoFilter] = useState('todos');
  const [tipoFilter, setTipoFilter] = useState('todos');
  const [search, setSearch] = useState('');

  useEffect(() => setMonthInput(periodo), [periodo]);

  const sorted = useMemo(() => [...unidades].sort((a, b) =>
    statusRank[a.resumen?.estado || 'sin_configurar'] - statusRank[b.resumen?.estado || 'sin_configurar']
    || a.nombre.localeCompare(b.nombre, 'es')
  ), [unidades]);

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    return sorted.flatMap(unit => {
      if (unidadFilter !== 'todas' && unit.id !== unidadFilter) return [];
      if (estadoFilter !== 'todos' && unit.resumen?.estado !== estadoFilter) return [];
      const matchUnit = normalize([unit.nombre, unit.grupo || '', unit.categoria || ''].join(' ')).includes(term);
      const allConcepts = unit.resumen?.conceptos || [];
      const concepts = allConcepts.filter(item =>
        (tipoFilter === 'todos' || item.tipo === tipoFilter) &&
        (!term || matchUnit || normalize([item.nombre, tipos[item.tipo] || item.tipo].join(' ')).includes(term))
      );
      if (tipoFilter !== 'todos' && concepts.length === 0) return [];
      if (term && !matchUnit && concepts.length === 0) return [];
      return [{ ...unit, concepts }];
    });
  }, [sorted, unidadFilter, estadoFilter, tipoFilter, search]);

  const summary = {
    withOverdue: unidades.filter(unit => unit.resumen?.estado === 'vencido').length,
    withPending: unidades.filter(unit => unit.resumen?.estado === 'pendiente').length,
    settled: unidades.filter(unit => unit.resumen?.estado === 'al_dia').length,
    unconfigured: unidades.filter(unit => unit.resumen?.estado === 'sin_configurar').length,
  };
  const hasOtherPages = totalUnidades > perPage;
  const changeMonth = (value: string) => {
    setMonthInput(value);
    if (/^(20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/.test(value) && value !== periodo) {
      startTransition(() => router.push(pageLink(locale, value, page)));
    }
  };

  return <main className="mx-auto w-full max-w-7xl space-y-6 pb-12" data-testid="gastos-overview">
    <header className="space-y-4">
      <Link href={'/' + locale + '/mis-unidades'}
        className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Mis unidades
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-primary">
            <WalletCards className="h-6 w-6" aria-hidden="true"/>
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Gastos y obligaciones</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Consultá expensas, impuestos y servicios <strong className="text-foreground">agrupados por unidad</strong>.
              Filtrá por propiedad, estado o concepto y entrá en cada una para registrar pagos.
            </p>
          </div>
        </div>
        <Link href={'/' + locale + '/mis-unidades'}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'min-h-[44px]' })}>
          <Building2 className="mr-2 h-4 w-4" /> Ver mis unidades
        </Link>
      </div>
    </header>

    <section aria-label="Resumen por unidad" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        { label: 'Con vencimientos', value: summary.withOverdue, tone: 'text-rose-700 dark:text-rose-300' },
        { label: 'Con pendientes', value: summary.withPending, tone: 'text-amber-700 dark:text-amber-300' },
        { label: 'Al día', value: summary.settled, tone: 'text-emerald-700 dark:text-emerald-300' },
        { label: 'Sin configurar', value: summary.unconfigured, tone: 'text-muted-foreground' },
      ].map(item => <div key={item.label} className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">{item.label}</p>
        <p className={'mt-1 text-2xl font-semibold tabular-nums ' + item.tone}>{item.value}</p>
        <p className="text-[11px] text-muted-foreground">unidades en esta página</p>
      </div>)}
    </section>

    <section aria-label="Filtros de gastos" className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Filter className="h-4 w-4 text-primary" /> Filtrar gastos
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block space-y-1.5 text-sm font-medium">
          <span>Unidad</span>
          <select data-testid="gastos-filter-unidad"
            className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={unidadFilter} onChange={event => setUnidadFilter(event.target.value)}>
            <option value="todas">Todas las unidades</option>
            {[...unidades].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
              .map(unit => <option key={unit.id} value={unit.id}>{unit.nombre}{unit.grupo ? ' · ' + unit.grupo : ''}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          <span>Estado de la unidad</span>
          <select data-testid="gastos-filter-estado"
            className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={estadoFilter} onChange={event => setEstadoFilter(event.target.value)}>
            <option value="todos">Todos los estados</option>
            {(['vencido','pendiente','al_dia','sin_vencimientos','sin_configurar'] as EstadoResumen[])
              .map(key => <option key={key} value={key}>{statusLabel[key]}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          <span>Tipo de gasto</span>
          <select data-testid="gastos-filter-tipo"
            className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={tipoFilter} onChange={event => setTipoFilter(event.target.value)}>
            <option value="todos">Todos los conceptos</option>
            {Object.entries(tipos).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> Período</span>
          <Input data-testid="gastos-filter-periodo" type="month" min="2000-01" max="2200-12"
            className="min-h-[44px] w-full" value={monthInput} onChange={event => changeMonth(event.target.value)}/>
        </label>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">
        <span>Buscar unidad o gasto</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input data-testid="gastos-search" className="min-h-[44px] pl-10" value={search}
            placeholder="Por ejemplo: Departamento 2, expensas, luz…"
            onChange={event => setSearch(event.target.value)} />
        </span>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {loading || monthInput !== periodo ? 'Cargando gastos del período…' :
            filtered.length + ' de ' + unidades.length + ' unidades visibles · ' + readableMonth(periodo)}
          {hasOtherPages && ' · Los filtros se aplican a esta página del inventario'}
        </p>
        {(unidadFilter !== 'todas' || estadoFilter !== 'todos' || tipoFilter !== 'todos' || search) && (
          <button type="button" className="min-h-[44px] text-sm font-medium text-primary hover:underline underline-offset-4"
            onClick={() => { setUnidadFilter('todas'); setEstadoFilter('todos'); setTipoFilter('todos'); setSearch(''); }}>
            Limpiar filtros
          </button>
        )}
      </div>
    </section>

    <section aria-label="Gastos agrupados por unidad" aria-busy={loading || monthInput !== periodo} className="space-y-4">
      {loading || monthInput !== periodo ? <p role="status" className="rounded-xl border bg-card p-6 text-muted-foreground">
        Actualizando las obligaciones del período seleccionado…
      </p> : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center space-y-2">
          <Search className="mx-auto h-7 w-7 text-muted-foreground"/>
          <h2 className="font-semibold">No hay unidades que coincidan</h2>
          <p className="text-sm text-muted-foreground">
            Probá cambiando el período o quitando alguno de los filtros.
          </p>
        </div>
      ) : filtered.map(unit => {
        const data = unit.resumen!;
        const detailHref = unitExpenseLink(locale, unit.id, periodo);
        return <article key={unit.id} data-testid={'gastos-unidad-' + unit.id}
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/80 bg-muted/20 p-4 sm:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="h-5 w-5"/>
              </span>
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Unidad</p>
                <h2 className="break-words text-lg font-semibold text-foreground">{unit.nombre}</h2>
                {(unit.grupo || unit.categoria) && <p className="text-xs text-muted-foreground">
                  {[unit.grupo, unit.categoria].filter(Boolean).join(' · ')}
                </p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={'inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ' + statusClass[data.estado]}>
                {statusLabel[data.estado]}
              </span>
              <Link className={buttonVariants({ size: 'sm', variant: 'outline', className: 'min-h-[44px]' })}
                href={detailHref}>
                {canManage ? 'Gestionar gastos' : 'Ver gastos'} <ArrowRight className="ml-2 h-4 w-4"/>
              </Link>
            </div>
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span><strong className="text-foreground">{data.conceptos.length}</strong> conceptos configurados</span>
              <span><strong className="text-foreground">{data.pagadas}</strong> pagados este mes</span>
              <span><strong className="text-foreground">{data.pendientes}</strong> pendientes este mes</span>
              {data.vencidas > 0 && <span className="font-semibold text-rose-700 dark:text-rose-300">
                {data.vencidas} vencimientos sin registrar como pagados, incluido el historial
              </span>}
            </div>

            {unit.concepts.length === 0 ? (
              <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {data.conceptos.length ? 'No hay conceptos de este tipo o búsqueda.' :
                    'Esta unidad todavía no tiene gastos configurados.'}
                </p>
                {canManage && !data.conceptos.length && <Link href={detailHref}
                  className={buttonVariants({ size: 'sm', className: 'min-h-[44px] self-start' })}>
                  <Plus className="mr-1.5 h-4 w-4"/> Agregar primer gasto
                </Link>}
              </div>
            ) : <ul className="divide-y divide-border/70 rounded-xl border border-border">
              {unit.concepts.map(item => <li key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-3.5 sm:px-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
                    <ReceiptText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-sm font-semibold text-foreground">{item.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {tipos[item.tipo] || item.tipo} · {frecuencia[item.frecuencia] || item.frecuencia}
                      {' · '}Paga: {responsable[item.responsable] || item.responsable}
                    </p>
                    {item.vencimiento && <p className="text-xs text-muted-foreground">
                      <CalendarDays className="mr-1 inline h-3.5 w-3.5"/>Vence {readableDue(item.vencimiento)}
                    </p>}
                    {item.periodos_vencidos > 0 && item.estado !== 'vencido' && <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                      {item.periodos_vencidos} períodos anteriores vencidos
                    </p>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3 text-right sm:shrink-0">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {formatMoney(item.monto_estimado, item.moneda)}
                    </p>
                    {item.estado === 'pagado' && item.monto_pagado !== null &&
                      <p className="text-xs text-muted-foreground">Pagado: {formatMoney(item.monto_pagado, item.moneda)}</p>}
                  </div>
                  <span className={'rounded-full border px-2.5 py-1 text-xs font-medium ' + conceptClass[item.estado]}>
                    {conceptLabel[item.estado]}
                  </span>
                </div>
              </li>)}
            </ul>}
          </div>
        </article>;
      })}
    </section>

    {totalUnidades > perPage && <nav aria-label="Páginas de unidades" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <span className="text-xs text-muted-foreground">
        Página {page} de {Math.max(1, Math.ceil(totalUnidades / perPage))} · {totalUnidades} unidades autorizadas
      </span>
      <div className="flex gap-2">
        {page > 1 && <Link href={pageLink(locale, periodo, page - 1)}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'min-h-[44px]' })}>Anterior</Link>}
        {page * perPage < totalUnidades && <Link href={pageLink(locale, periodo, page + 1)}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'min-h-[44px]' })}>Siguiente</Link>}
      </div>
    </nav>}

    <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0"/>
      <p>Este panel muestra información privada de tus unidades autorizadas. Los estados se calculan según
        los pagos que registraste en Rendo; no consultan automáticamente impuestos o servicios externos.
        Los importes se muestran individualmente para no sumar monedas distintas.</p>
    </div>
  </main>;
}
