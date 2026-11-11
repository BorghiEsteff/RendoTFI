'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

type Publication = {
  id: string;
  gestor_id: string;
  titulo_es: string | null;
  categoria: string;
  estado: string;
  reportes_count: number;
  created_at: string;
  updated_at: string;
};
type ModerationPage = { data: Publication[]; total: number; page: number; pageSize: number };
type Report = { id: string; motivo: string; created_at: string };
type AuditEvent = {
  id: string;
  accion: string;
  actor_rol: string;
  created_at: string;
  metadata: { estado_anterior?: string; estado_nuevo?: string } | null;
};
type Detail = {
  unidad: Pick<Publication,'id'|'titulo_es'|'estado'|'reportes_count'>;
  reportes: Report[];
  reportesTotal: number;
  historial: AuditEvent[];
};

const statuses: Record<string,string> = {
  publicada:'Publicada', en_revision:'En revisión', suspendida:'Suspendida',
  pausada:'Pausada', no_disponible:'No disponible', borrador:'Borrador',
  archivada:'Archivada', bloqueada_por_impago:'Bloqueada por impago',
};
const options = [
  ['todas','Todas las publicaciones'],
  ['reportadas','Con al menos un reporte'],
  ['en_revision','En revisión'],
  ['publicada','Publicadas'],
  ['suspendida','Suspendidas'],
  ['pausada','Pausadas'],
  ['no_disponible','No disponibles'],
  ['borrador','Borradores'],
  ['archivada','Archivadas'],
  ['bloqueada_por_impago','Bloqueadas por impago'],
] as const;
const actionsAllowed: Record<string, Array<{ action: string; label: string; danger?: boolean }>> = {
  publicada: [{action:'revisar',label:'Enviar a revisión'}, {action:'suspender',label:'Suspender',danger:true}],
  pausada: [{action:'revisar',label:'Enviar a revisión'}, {action:'suspender',label:'Suspender',danger:true}],
  no_disponible: [{action:'revisar',label:'Enviar a revisión'}, {action:'suspender',label:'Suspender',danger:true}],
  en_revision: [{action:'restaurar',label:'Restaurar estado'}, {action:'suspender',label:'Suspender',danger:true}],
  suspendida: [{action:'restaurar',label:'Restaurar estado'}],
};

const formatDate = (value?: string): string => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha inválida' : date.toLocaleString('es-AR');
};

export default function ModerationConsole() {
  const [filter,setFilter] = useState('todas');
  const [input,setInput] = useState('');
  const [search,setSearch] = useState('');
  const [page,setPage] = useState(1);
  const [result,setResult] = useState<ModerationPage | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState<string | null>(null);
  const [selected,setSelected] = useState<string | null>(null);
  const [detail,setDetail] = useState<Detail | null>(null);
  const [detailLoading,setDetailLoading] = useState(false);
  const [detailError,setDetailError] = useState('');

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const { data: { session }, error: sessionError } = await createClient().auth.getSession();
    if (sessionError || !session?.access_token) {
      throw new Error('La sesión expiró. Iniciá sesión nuevamente.');
    }
    const response = await fetch('/api/dev/' + path, {
      ...init, cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer ' + session.access_token,
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('No tenés permisos para acceder a moderación.');
      }
      throw new Error('El servidor no pudo completar la operación (' + response.status + ').');
    }
    return response.json() as Promise<T>;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ estado:filter, pagina:String(page), q:search });
      const data = await api<ModerationPage>('moderacion?' + params);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las publicaciones.');
    } finally {
      setLoading(false);
    }
  },[api,filter,page,search]);

  useEffect(() => { void load(); },[load]);

  const openDetail = async (id:string) => {
    if (selected === id) { setSelected(null); setDetail(null); return; }
    setSelected(id);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const data = await api<Detail>('moderacion/' + encodeURIComponent(id) + '/reportes');
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'No se pudo cargar el detalle.');
    } finally {
      setDetailLoading(false);
    }
  };

  const run = async (unit: Publication, action: string) => {
    const wording:Record<string,string> = {
      revisar:'enviar a revisión', suspender:'suspender', restaurar:'restaurar',
    };
    if (!window.confirm('¿Confirmás ' + (wording[action] ?? action) + ' «' +
      (unit.titulo_es || unit.categoria) +
      '»? El cambio será efectivo de inmediato y quedará auditado.')) return;
    setBusy(unit.id);
    setError('');
    setNotice('');
    try {
      const result = await api<{estado:string}>('moderacion/' + encodeURIComponent(unit.id),{
        method:'PATCH',
        body:JSON.stringify({accion:action}),
      });
      setSelected(null);
      setDetail(null);
      setNotice('Estado actualizado: ' + (statuses[result.estado] || result.estado) +
        '. La decisión quedó registrada en auditoría.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la decisión.');
    } finally {
      setBusy(null);
    }
  };

  const applySearch = (e:FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPage(1);
    setSearch(input.trim());
  };
  const count = result?.total ?? 0;
  const pages = Math.max(1,Math.ceil(count/(result?.pageSize || 25)));

  return (
    <section className="space-y-5" aria-label="Moderación de publicaciones">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Moderación de publicaciones</h2>
          <p className="mt-1 text-sm text-slate-400">
            Revisá cualquier publicación, incluso con un solo reporte.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || !!busy}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
          Actualizar
        </button>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 lg:grid-cols-[260px_1fr]">
        <label className="text-sm text-slate-300">
          Estado o prioridad
          <select value={filter} onChange={e => {setFilter(e.target.value);setPage(1);setSelected(null);setDetail(null);}}
            className="mt-1 block min-h-[43px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-slate-100">
            {options.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <form onSubmit={applySearch} className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-sm text-slate-300">
            Buscar publicaciones por título
            <input value={input} onChange={e=>setInput(e.target.value)} maxLength={100}
              placeholder="Título de la publicación"
              className="mt-1 min-h-[43px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-slate-100" />
          </label>
          <button type="submit" disabled={loading}
            className="min-h-[43px] rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
            Buscar
          </button>
        </form>
        <p className="text-xs text-slate-400 lg:col-span-2">
          Las publicaciones reportadas se muestran desde el primer reporte. El umbral automático de 50 no limita la revisión manual.
        </p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/50 p-4 text-sm text-rose-100">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 text-sm text-emerald-100">{notice}</p>}
      {loading && <p role="status" className="p-4 text-sm text-slate-300">Consultando publicaciones reales…</p>}
      {!loading && result && (
        <>
          <div className="flex flex-wrap justify-between gap-2 text-sm text-slate-300">
            <span>{count} publicación{count === 1 ? '' : 'es'} encontrada{count === 1 ? '' : 's'}</span>
            <span>Página {page} de {pages}</span>
          </div>
          {result.data.length === 0 && <p className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
            No hay publicaciones para este filtro.
          </p>}
          <div className="space-y-3">
            {result.data.map(unit => {
              const actions = actionsAllowed[unit.estado] || [];
              const isOpen = selected === unit.id;
              return (
                <article key={unit.id} className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words font-semibold">{unit.titulo_es || 'Sin título'} <span className="font-normal text-slate-400">· {unit.categoria}</span></h3>
                      <p className="mt-1 break-all text-xs text-slate-500">Publicación {unit.id}</p>
                      <p className="mt-1 break-all text-xs text-slate-500">Gestor {unit.gestor_id}</p>
                      <p className="mt-2 text-xs text-slate-400">Creada: {formatDate(unit.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <span className="inline-block rounded-lg border border-slate-700 bg-slate-950 px-3 py-1 text-xs">
                        {statuses[unit.estado] || unit.estado}
                      </span>
                      <p className={'mt-2 text-sm font-semibold ' + ((unit.reportes_count ?? 0) > 0 ? 'text-amber-300' : 'text-slate-400')}>
                        {unit.reportes_count ?? 0} reporte{unit.reportes_count === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void openDetail(unit.id)} disabled={!!busy}
                      aria-expanded={isOpen}
                      className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
                      {isOpen ? 'Ocultar reportes e historial' : 'Ver reportes e historial'}
                    </button>
                    {actions.map(({action,label,danger}) => (
                      <button key={action} type="button" onClick={() => void run(unit,action)}
                        disabled={busy !== null}
                        className={'rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ' +
                          (danger ? 'border-rose-700 text-rose-200 hover:bg-rose-950' : 'border-emerald-700 text-emerald-200 hover:bg-emerald-950')}>
                        {busy===unit.id?'Procesando…':label}
                      </button>
                    ))}
                    {actions.length===0 && <p className="self-center text-xs text-slate-500">
                      Estado protegido: sin acciones de publicación desde moderación
                    </p>}
                  </div>
                  {isOpen && (
                    <div className="mt-4 grid gap-4 border-t border-slate-700 pt-4 lg:grid-cols-2">
                      {detailLoading && <p role="status" className="text-sm text-slate-300">Cargando detalle…</p>}
                      {detailError && <p role="alert" className="text-sm text-rose-300">{detailError}</p>}
                      {detail && !detailLoading && (
                        <>
                          <div>
                            <h4 className="font-semibold">Reportes ({detail.reportesTotal})</h4>
                            {detail.reportes.length===0
                              ? <p className="mt-2 text-sm text-slate-400">No se registraron reportes para esta publicación.</p>
                              : <ul className="mt-2 space-y-2">
                                  {detail.reportes.map(report=><li key={report.id} className="rounded-lg bg-slate-950 p-3">
                                    <p className="whitespace-pre-wrap break-words text-sm">{report.motivo}</p>
                                    <p className="mt-1 text-xs text-slate-400">{formatDate(report.created_at)}</p>
                                  </li>)}
                                </ul>}
                            {detail.reportesTotal>100 && <p className="mt-2 text-xs text-slate-400">Mostrando los últimos 100 reportes.</p>}
                          </div>
                          <div>
                            <h4 className="font-semibold">Historial de moderación</h4>
                            {detail.historial.length===0
                              ? <p className="mt-2 text-sm text-slate-400">Aún no hay decisiones administrativas registradas.</p>
                              : <ul className="mt-2 space-y-2">
                                {detail.historial.map(log=><li key={log.id} className="rounded-lg bg-slate-950 p-3">
                                  <p className="text-sm">{log.accion.replace('dev_moderacion_','').toUpperCase()}</p>
                                  <p className="mt-1 text-xs text-slate-400">{log.metadata?.estado_anterior ?? '—'} → {log.metadata?.estado_nuevo ?? '—'}</p>
                                  <p className="mt-1 text-xs text-slate-400">{formatDate(log.created_at)}</p>
                                </li>)}
                              </ul>}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-4">
            <button type="button" disabled={page<=1 || loading || !!busy}
              onClick={() => {setPage(p=>Math.max(1,p-1));setSelected(null);setDetail(null);}}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm disabled:opacity-40 hover:bg-slate-800">
              Anterior
            </button>
            <span className="text-xs text-slate-400">{count} resultados · {result.pageSize} por página</span>
            <button type="button" disabled={page>=pages || loading || !!busy}
              onClick={() => {setPage(p=>p+1);setSelected(null);setDetail(null);}}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm disabled:opacity-40 hover:bg-slate-800">
              Siguiente
            </button>
          </div>
        </>
      )}
    </section>
  );
}
