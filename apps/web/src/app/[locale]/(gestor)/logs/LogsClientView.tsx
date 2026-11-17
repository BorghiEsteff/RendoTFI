'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  History, Search, UserRound, CalendarClock, RotateCcw,
  Building2, Users, FileText, ChevronLeft, ChevronRight, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface LogEntry {
  id: string;
  actorId: string;
  actorNombre: string | null;
  actorRol: string;
  accion: string;
  entidadTipo: string;
  entidadRef: string | null;
  recursoNombre: string | null;
  objetivoNombre: string | null;
  metadata: Record<string, unknown>;
  fecha: string;
}

const humanState: Record<string, string> = {
  borrador: 'Borrador', publicada: 'Publicada', pausada: 'Pausada',
  no_disponible: 'No disponible', archivada: 'Archivada',
  en_revision: 'En revisión', suspendida: 'Suspendida',
  bloqueada_por_impago: 'Bloqueada por impago',
};

function textField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function category(action: string): string {
  if (action.includes('invitacion') || action.includes('delegacion')) return 'delegados';
  if (action.includes('unidades') || action.includes('unidad') || action.includes('modalidades_precio') || action.includes('grupos')) return 'unidades';
  if (action.includes('alquileres') || action.includes('pagos') || action.includes('cobranzas') || action.includes('cuotas')) return 'alquileres';
  if (action.includes('inquilinos')) return 'inquilinos';
  return 'otros';
}

function presentation(log: LogEntry) {
  const isDelegate = log.actorRol === 'delegado';
  const role = isDelegate ? 'El delegado' : log.actorRol === 'gestor' ? 'El gestor' : 'El sistema';
  const actor = log.actorNombre ? role + ' ' + log.actorNombre : role;
  const target = log.objetivoNombre;
  const unit = log.recursoNombre;
  const named = (name: string | null, noun: string) => name ? noun + ' «' + name + '»' : noun;
  let title: string;

  switch (log.accion) {
    case 'crear_invitacion':
    case 'invitar_delegado':
      title = actor + (target ? ' invitó a ' + target + ' para ser delegado.' : ' envió una invitación para ser delegado.');
      break;
    case 'aceptar_invitacion':
      title = actor + ' aceptó la invitación para ser delegado.';
      break;
    case 'rechazar_invitacion':
      title = actor + ' rechazó una invitación para ser delegado.';
      break;
    case 'cancelar_invitacion':
      title = actor + (target ? ' canceló la invitación enviada a ' + target + '.' : ' canceló una invitación.');
      break;
    case 'configurar_delegacion':
      title = actor + (target ? ' configuró los permisos de ' + target + '.' : ' configuró los permisos de un delegado.');
      break;
    case 'revocar_delegacion':
      title = actor + (target ? ' revocó el acceso de ' + target + '.' : ' revocó el acceso de un delegado.');
      break;
    case 'crear_unidades':
    case 'crear_unidad':
      title = actor + ' creó ' + named(unit, 'una unidad') + '.';
      break;
    case 'actualizar_unidades':
      title = actor + ' actualizó ' + named(unit, 'una unidad') + '.';
      break;
    case 'cambiar_estado_unidad':
    case 'cambio_estado':
      title = actor + ' cambió el estado de ' + named(unit, 'una unidad') + '.';
      break;
    case 'eliminar_unidades':
    case 'eliminar_fisico_unidades':
      title = actor + ' eliminó ' + named(unit, 'una unidad') + '.';
      break;
    case 'crear_modalidades_precio':
      title = actor + ' agregó una tarifa' + (unit ? ' a la unidad «' + unit + '»' : ' a una unidad') + '.';
      break;
    case 'actualizar_modalidades_precio':
    case 'modificar_precio':
      title = actor + ' modificó una tarifa' + (unit ? ' de la unidad «' + unit + '»' : ' de una unidad') + '.';
      break;
    case 'eliminar_modalidades_precio':
      title = actor + ' eliminó una tarifa' + (unit ? ' de la unidad «' + unit + '»' : '') + '.';
      break;
    case 'crear_grupos':
      title = actor + ' creó ' + named(unit, 'un grupo') + '.';
      break;
    case 'actualizar_grupos':
      title = actor + ' actualizó ' + named(unit, 'un grupo') + '.';
      break;
    case 'eliminar_grupos':
      title = actor + ' eliminó ' + named(unit, 'un grupo') + '.';
      break;
    case 'crear_inquilinos':
      title = actor + ' registró ' + named(unit, 'un inquilino') + '.';
      break;
    case 'actualizar_inquilinos':
      title = actor + ' actualizó los datos de ' + named(unit, 'un inquilino') + '.';
      break;
    case 'eliminar_inquilinos':
      title = actor + ' eliminó el registro de ' + named(unit, 'un inquilino') + '.';
      break;
    case 'crear_alquileres':
    case 'crear_alquiler':
      title = actor + ' registró un nuevo alquiler' + (unit ? ' en «' + unit + '»' : '') + '.';
      break;
    case 'actualizar_alquileres':
      title = actor + ' modificó un alquiler' + (unit ? ' de «' + unit + '»' : '') + '.';
      break;
    case 'eliminar_alquileres':
      title = actor + ' eliminó un registro de alquiler' + (unit ? ' de «' + unit + '»' : '') + '.';
      break;
    default:
      title = actor + ' realizó una acción en Rendo.';
  }

  const detail: string[] = [];
  if (log.accion === 'aceptar_invitacion') detail.push('La invitación fue aceptada; los permisos pueden quedar pendientes de configuración.');
  if (log.accion === 'crear_invitacion') detail.push('La invitación fue registrada. Su aceptación se muestra en un evento independiente.');
  if (log.accion === 'configurar_delegacion') {
    const permission = textField(log.metadata.permiso);
    const scope = textField(log.metadata.alcance_tipo);
    if (permission) detail.push('Permiso: ' + (permission === 'gestionar' ? 'Gestionar' : permission === 'ver' ? 'Solo lectura' : permission));
    if (scope) detail.push('Alcance: ' + ({ cuenta: 'Toda la cuenta', grupo: 'Un grupo', unidades: 'Unidades seleccionadas' } as Record<string, string>)[scope] || 'Alcance: ' + scope);
  }
  if (log.accion === 'cambiar_estado_unidad') {
    const from = textField(log.metadata.estado_anterior);
    const to = textField(log.metadata.nuevo_estado);
    if (from || to) detail.push('Estado: ' + (from ? humanState[from] || from : 'No disponible') + ' → ' + (to ? humanState[to] || to : 'No disponible'));
  }
  if (log.recursoNombre && !title.includes('«' + log.recursoNombre + '»')) detail.push('Registro: ' + log.recursoNombre);
  return { title, detail, group: category(log.accion) };
}

export default function LogsClientView({
  initialLogs = [], initialError = false, total = 0, currentPage = 1,
  pageSize = 50, locale = 'es',
}: {
  initialLogs?: LogEntry[];
  initialError?: boolean;
  total?: number;
  currentPage?: number;
  pageSize?: number;
  locale?: string;
}) {
  const [actorFilter, setActorFilter] = useState('todos');
  const [categoryFilter, setCategoryFilter] = useState('todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showTechnical, setShowTechnical] = useState(false);
  const currentLocale = locale === 'pt' ? 'pt-BR' : locale === 'en' ? 'en-US' : 'es-AR';
  const formatDate = (raw: string) => {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? 'Fecha no disponible'
      : new Intl.DateTimeFormat(currentLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
  };

  const filteredLogs = useMemo(() => initialLogs.filter(log => {
    if (actorFilter !== 'todos' && log.actorRol !== actorFilter) return false;
    if (categoryFilter !== 'todas' && category(log.accion) !== categoryFilter) return false;
    const isoDate = Number.isNaN(new Date(log.fecha).getTime()) ? '' : new Date(log.fecha).toISOString().slice(0, 10);
    if (dateFrom && isoDate < dateFrom) return false;
    if (dateTo && isoDate > dateTo) return false;
    if (searchQuery.trim()) {
      const searchable = [
        log.actorNombre, log.objetivoNombre, log.recursoNombre,
        presentation(log).title, ...presentation(log).detail,
      ].filter(Boolean).join(' ').toLocaleLowerCase(currentLocale);
      if (!searchable.includes(searchQuery.trim().toLocaleLowerCase(currentLocale))) return false;
    }
    return true;
  }), [initialLogs, actorFilter, categoryFilter, searchQuery, dateFrom, dateTo, currentLocale]);

  const reset = () => {
    setActorFilter('todos');
    setCategoryFilter('todas');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
  };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageUrl = (page: number) => '/' + locale + '/logs?page=' + page;
  const hasFilters = actorFilter !== 'todos' || categoryFilter !== 'todas' || !!searchQuery || !!dateFrom || !!dateTo;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <History aria-hidden="true" className="h-6 w-6 text-primary" />
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Registro de actividad</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Consultá qué hizo cada persona, cuándo ocurrió y qué cambió en tus unidades.
        </p>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {total} eventos en total · Página {currentPage} de {totalPages}
        </p>
      </header>

      {initialError ? (
        <div data-testid="logs-api-error" role="alert" className="rounded-xl border border-destructive/30 p-6 space-y-2">
          <div className="flex items-center gap-2 text-destructive font-semibold"><AlertCircle className="w-5 h-5" /> No se pudo cargar la actividad</div>
          <p className="text-sm text-muted-foreground">No se mostraron datos incompletos. Revisá tu conexión e intentá nuevamente.</p>
          <Link href={pageUrl(currentPage)} className="inline-flex items-center min-h-[44px] underline underline-offset-4">Reintentar</Link>
        </div>
      ) : (
        <>
          <section aria-label="Filtrar actividad" className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <label className="block text-sm font-medium" htmlFor="audit-search">Buscar actividad</label>
            <div className="relative">
              <Search aria-hidden="true" className="h-4 w-4 absolute left-3 top-3.5 text-muted-foreground" />
              <Input id="audit-search" placeholder="Nombre, unidad o acción…" className="pl-9 min-h-[44px]"
                value={searchQuery} onChange={event => setSearchQuery(event.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="text-xs space-y-1">Quién realizó la acción
                <select aria-label="Filtrar por actor" className="w-full min-h-[44px] rounded-lg bg-background border border-input px-3"
                  value={actorFilter} onChange={event => setActorFilter(event.target.value)}>
                  <option value="todos">Todas las personas</option><option value="gestor">Gestor</option><option value="delegado">Delegados</option>
                </select>
              </label>
              <label className="text-xs space-y-1">Tipo de actividad
                <select aria-label="Filtrar por tipo" className="w-full min-h-[44px] rounded-lg bg-background border border-input px-3"
                  value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
                  <option value="todas">Todos los tipos</option><option value="delegados">Delegados e invitaciones</option>
                  <option value="unidades">Unidades y tarifas</option><option value="alquileres">Alquileres y pagos</option>
                  <option value="inquilinos">Inquilinos</option><option value="otros">Otros</option>
                </select>
              </label>
              <label className="text-xs space-y-1">Desde
                <Input type="date" aria-label="Desde" className="min-h-[44px]" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </label>
              <label className="text-xs space-y-1">Hasta
                <Input type="date" aria-label="Hasta" className="min-h-[44px]" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{hasFilters ? 'Los filtros se aplican a esta página del historial.' : 'Eventos ordenados del más reciente al más antiguo.'}</span>
              <Button variant="outline" size="sm" onClick={reset} className="min-h-[44px]"><RotateCcw className="w-4 h-4 mr-2" />Limpiar filtros</Button>
            </div>
          </section>

          <section aria-label="Eventos registrados" data-testid="logs-list" className="space-y-3">
            {filteredLogs.length === 0 ? (
              <div data-testid="logs-empty-state" className="rounded-2xl border border-border bg-card p-8 text-center space-y-2">
                <p className="font-semibold">No se encontraron eventos</p>
                <p className="text-sm text-muted-foreground">{initialLogs.length ? 'Probá cambiar los filtros.' : 'Todavía no hay actividad registrada en esta página.'}</p>
              </div>
            ) : filteredLogs.map(log => {
              const item = presentation(log);
              const EventIcon = item.group === 'delegados' ? Users : item.group === 'unidades' ? Building2 : item.group === 'alquileres' ? FileText : UserRound;
              return (
                <article key={log.id} data-testid="log-entry-item" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex gap-3 items-start">
                    <div className="rounded-xl bg-muted p-2.5 shrink-0"><EventIcon aria-hidden="true" className="w-5 h-5 text-foreground" /></div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-sm sm:text-base font-semibold text-foreground leading-relaxed">{item.title}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" aria-hidden="true" /><time dateTime={log.fecha}>{formatDate(log.fecha)}</time></p>
                      {item.detail.length > 0 && (
                        <ul className="space-y-1 text-sm text-muted-foreground">{item.detail.map((line, i) => <li key={i}>{line}</li>)}</ul>
                      )}
                      {log.entidadTipo === 'unidades' && log.entidadRef && log.recursoNombre && (
                        <Link className="inline-block text-sm text-primary underline underline-offset-4 min-h-[44px] py-2"
                          href={'/' + locale + '/mis-unidades/' + log.entidadRef + '/editar'}>Ver unidad</Link>
                      )}
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer min-h-[40px] inline-flex items-center">Detalles técnicos</summary>
                        <div className="rounded-lg bg-muted p-3 space-y-1 break-all">
                          <p>Acción: {log.accion}</p>
                          <p>Actor: {log.actorId}</p>
                          <p>Referencia: {log.entidadTipo} / {log.entidadRef || 'Sin referencia'}</p>
                          <p>Evento: {log.id}</p>
                        </div>
                      </details>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          {totalPages > 1 && (
            <nav aria-label="Páginas del historial" className="flex items-center justify-between gap-4">
              {currentPage > 1 ? (
                <Link href={pageUrl(currentPage - 1)} className="inline-flex min-h-[44px] items-center gap-2 px-3 rounded-lg border border-border hover:bg-muted"><ChevronLeft className="h-4 w-4" /> Anterior</Link>
              ) : <span />}
              <span className="text-xs text-muted-foreground">Página {currentPage} / {totalPages}</span>
              {currentPage < totalPages ? (
                <Link href={pageUrl(currentPage + 1)} className="inline-flex min-h-[44px] items-center gap-2 px-3 rounded-lg border border-border hover:bg-muted">Siguiente <ChevronRight className="h-4 w-4" /></Link>
              ) : <span />}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
