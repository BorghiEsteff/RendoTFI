'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Screen = 'metricas' | 'moderacion' | 'auditoria-pagos' | 'logs';
type RecordRow = Record<string, unknown>;
type Overview = {
  checkedAt: string;
  databaseQueryMs: number;
  unidades: number;
  moderacionPendiente: number;
  pagosPendientes: number;
  eventosAuditoria: number;
  usuariosActivos: number;
};
const textValue = (value: unknown): string => value == null ? '—' : String(value);
const dateValue = (value: unknown): string => {
  if (typeof value !== 'string') return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString('es-AR');
};
const money = (amount: unknown): string => {
  const numeric = Number(amount);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(numeric)
    : '—';
};

const endpoints: Record<Screen, string> = {
  metricas: 'resumen',
  moderacion: 'moderacion',
  'auditoria-pagos': 'pagos',
  logs: 'logs',
};

export default function DevConsoleClient({ screen }: { screen: Screen }) {
  const [overview,setOverview] = useState<Overview | null>(null);
  const [rows,setRows] = useState<RecordRow[]>([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState<string | null>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [filter,setFilter] = useState('');

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const { data: { session }, error: authError } = await createClient().auth.getSession();
    if (authError || !session?.access_token) throw new Error('La sesión expiró. Volvé a iniciar sesión.');
    const response = await fetch('/api/dev/' + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('No tenés permisos para esta operación.');
      throw new Error('La operación falló (' + response.status + '). Actualizá e intentá nuevamente.');
    }
    return response.json();
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await request(endpoints[screen]);
      if (screen === 'metricas') {
        setOverview(result as Overview);
      } else {
        setRows(Array.isArray(result?.data) ? result.data : []);
      }
    } catch (err) {
      setRows([]);
      setOverview(null);
      setError(err instanceof Error ? err.message : 'No se pudieron cargar datos.');
    } finally {
      setLoading(false);
    }
  },[request,screen]);

  useEffect(() => { void reload(); },[reload]);

  const filteredRows = useMemo(() => {
    if (!filter.trim()) return rows;
    const search = filter.toLowerCase();
    return rows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(search)));
  },[filter,rows]);

  const act = async (id: string, action: string) => {
    const isPayment = screen === 'auditoria-pagos';
    const label = isPayment ? 'pago' : 'publicación';
    if (!window.confirm('¿Confirmás ' + action + ' esta ' + label + '? Esta acción se registra en auditoría.')) return;
    setBusy(id);
    setError('');
    setNotice('');
    try {
      const route = isPayment ? 'pagos/' : 'moderacion/';
      const body = isPayment ? { decision: action } : { accion: action };
      await request(route + encodeURIComponent(id), { method:'PATCH', body:JSON.stringify(body) });
      setNotice('Acción confirmada y registrada.');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falló la operación.');
    } finally {
      setBusy(null);
    }
  };

  const button = (id: string, action: string, label: string, destructive = false) => (
    <button type="button" disabled={busy !== null}
      onClick={() => void act(id,action)}
      className={'rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ' +
        (destructive ? 'border-rose-700 text-rose-200 hover:bg-rose-950' : 'border-emerald-700 text-emerald-200 hover:bg-emerald-950')}>
      {busy === id ? 'Procesando…' : label}
    </button>
  );

  const titles: Record<Screen,string> = {
    metricas:'Estado operativo de Rendo',
    moderacion:'Cola de moderación',
    'auditoria-pagos':'Pagos manuales pendientes',
    logs:'Auditoría global',
  };

  return (
    <section className="space-y-5" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{titles[screen]}</h2>
          <p className="mt-1 text-xs text-slate-400">Sin datos simulados. Información consultada en la base de beta.</p>
        </div>
        <button onClick={() => void reload()} disabled={loading || busy !== null} type="button"
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">Actualizar</button>
      </div>
      {loading && <p role="status" className="rounded-lg bg-slate-900 p-4 text-sm">Cargando datos reales…</p>}
      {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-200">{notice}</p>}
      {!loading && !error && screen === 'metricas' && overview && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {([
              ['Usuarios activos',overview.usuariosActivos],
              ['Unidades',overview.unidades],
              ['Moderación pendiente',overview.moderacionPendiente],
              ['Pagos manuales pendientes',overview.pagosPendientes],
              ['Eventos auditados',overview.eventosAuditoria],
              ['Consulta a base (ms)',overview.databaseQueryMs],
            ] as [string,number][]).map(([label,value]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString('es-AR')}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">Última consulta: {dateValue(overview.checkedAt)}. La duración es de la consulta al backend, no una métrica de latencia p95.</p>
        </>
      )}
      {!loading && !error && screen !== 'metricas' && (
        <>
          <label className="block text-sm text-slate-300">
            Buscar en la lista cargada
            <input value={filter} onChange={event => setFilter(event.target.value)}
              placeholder="Filtrar por ID, estado, título o acción"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100 outline-none focus:border-emerald-400" />
          </label>
          {filteredRows.length === 0
            ? <p className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">No hay registros para mostrar.</p>
            : <div className="space-y-3">
                {filteredRows.map((row,index) => {
                  const id=textValue(row.id);
                  return (
                    <article key={id === '—' ? index : id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                      {screen === 'moderacion' && <>
                        <h3 className="font-semibold">{textValue(row.titulo_es || row.categoria)}</h3>
                        <p className="mt-1 break-all text-xs text-slate-400">Unidad: {id} · Gestor: {textValue(row.gestor_id)}</p>
                        <p className="mt-2 text-sm">{textValue(row.reportes_count)} reportes · Estado: {textValue(row.estado)}</p>
                        <div className="mt-3 flex flex-wrap gap-2">{button(id,'restaurar','Restaurar')}{button(id,'suspender','Suspender',true)}</div>
                      </>}
                      {screen === 'auditoria-pagos' && <>
                        <h3 className="font-semibold">{money(row.monto)}</h3>
                        <p className="mt-1 break-all text-xs text-slate-400">Pago: {id} · Gestor: {textValue(row.gestor_id)}</p>
                        <p className="mt-2 text-sm">Método: {textValue(row.metodo)} · Cupo adquirido: {textValue(row.cupo_adquirido)} · {dateValue(row.created_at)}</p>
                        <div className="mt-3 flex flex-wrap gap-2">{button(id,'aprobar','Aprobar y acreditar')}{button(id,'rechazar','Rechazar',true)}</div>
                      </>}
                      {screen === 'logs' && <>
                        <h3 className="font-semibold">{textValue(row.accion)}</h3>
                        <p className="mt-1 break-all text-xs text-slate-400">{dateValue(row.created_at)} · Actor: {textValue(row.actor_id)} ({textValue(row.actor_rol)})</p>
                        <p className="mt-2 break-all text-sm">Workspace: {textValue(row.gestor_id)} · {textValue(row.recurso_tipo)} · {textValue(row.recurso_id)}</p>
                      </>}
                    </article>
                  );
                })}
              </div>
          }
          <p className="text-xs text-slate-500">La consulta está limitada a los primeros {screen === 'logs' ? 200 : 100} registros.</p>
        </>
      )}
    </section>
  );
}
