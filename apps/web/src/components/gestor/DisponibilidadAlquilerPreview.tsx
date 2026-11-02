'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RentalModality } from '@tfi/types';
import { getClientAuthToken } from '@/lib/supabase/client-token';
import { toArgentinaMidnight, toArgentinaHourlyInterval } from './rental-wizard-pricing';

type Block = { inicio_at: string; fin_at: string };
type Result = { ocupaciones: Block[]; truncado: boolean; reglas_operativas: string };

export function DisponibilidadAlquilerPreview({
  unidadId, modalidad, inicio, fin, horaInicio, horaFin, token,
}: {
  unidadId: string;
  modalidad: RentalModality;
  inicio?: Date; fin?: Date;
  horaInicio: string; horaFin: string;
  token: string;
}) {
  const range = useMemo(() => {
    if (!unidadId || !inicio || !fin || Number.isNaN(inicio.getTime()) ||
        Number.isNaN(fin.getTime())) return null;
    try {
      let start: string;
      let end: string;
      if (modalidad === 'por_hora') {
        if (!/^\d{2}:\d{2}$/.test(horaInicio) || !/^\d{2}:\d{2}$/.test(horaFin) ||
            horaInicio === horaFin) return null;
        const interval = toArgentinaHourlyInterval(inicio, horaInicio, horaFin);
        start = interval.inicio; end = interval.fin;
      } else {
        start = toArgentinaMidnight(inicio);
        end = toArgentinaMidnight(fin);
      }
      if (Date.parse(end) <= Date.parse(start)) return null;
      return {start,end};
    } catch {
      return null;
    }
  }, [unidadId, modalidad, inicio, fin, horaInicio, horaFin]);

  const [state,setState] = useState<'idle'|'loading'|'error'|'ready'>('idle');
  const [data,setData] = useState<Result|null>(null);
  useEffect(() => {
    if (!unidadId || !range) {setState('idle');setData(null);return;}
    const ctrl = new AbortController();
    setState('loading');setData(null);
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({ desde: range.start, hasta: range.end });
      fetch((process.env.NEXT_PUBLIC_API_URL||'')+
        '/unidades/'+encodeURIComponent(unidadId)+'/disponibilidad?'+params.toString(), {
        headers:{Authorization:'Bearer '+getClientAuthToken(token)},
        cache:'no-store',signal:ctrl.signal,
      }).then(async r => {
        if (!r.ok) throw new Error('No se pudo verificar');
        const payload:Result = await r.json();
        if (!Array.isArray(payload.ocupaciones)||typeof payload.truncado!=='boolean')
          throw new Error('Respuesta incompleta');
        if (!ctrl.signal.aborted) {setData(payload);setState('ready');}
      }).catch(() => {if (!ctrl.signal.aborted)setState('error');});
    }, 300);
    return () => {clearTimeout(timeout);ctrl.abort();};
  },[unidadId,range,token]);

  const conflict = data?.ocupaciones.some(x => range &&
    Date.parse(x.inicio_at)<Date.parse(range.end) &&
    Date.parse(x.fin_at)>Date.parse(range.start)) || false;
  return <div className="rounded-xl border border-border bg-background/70 px-3 py-3 text-xs space-y-1"
    data-testid="alquiler-disponibilidad-preview" role="status" aria-live="polite">
    <p className="font-semibold">Ocupación de la unidad seleccionada</p>
    {state==='idle'&&<p className="text-muted-foreground">Seleccioná unidad y un intervalo válido para consultar reservas.</p>}
    {state==='loading'&&<p className="text-muted-foreground">Comprobando las reservas existentes…</p>}
    {state==='error'&&<p className="text-destructive" data-testid="disponibilidad-error">
      No pudimos verificar la ocupación. No asumas que el período está libre.
    </p>}
    {state==='ready'&&data&&(conflict?
      <p className="font-semibold text-red-600 dark:text-red-400" data-testid="disponibilidad-conflicto">
        El período se superpone con una reserva registrada. Elegí otras fechas u horarios.
      </p>:
      <p className="font-semibold text-amber-700 dark:text-amber-300" data-testid="disponibilidad-sin-cruces">
        No se encontraron reservas cruzadas en este intervalo.
      </p>)}
    {state==='ready'&&data&&<p className="text-muted-foreground">
      Esta es una vista previa. La validación definitiva se hace al guardar y las reglas de
      horarios y cierres por mantenimiento todavía no están configuradas.
      {data.truncado?' Se alcanzó el límite de resultados; verificación incompleta.':''}
    </p>}
  </div>;
}
