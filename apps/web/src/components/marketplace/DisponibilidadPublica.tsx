'use client';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarClock, RefreshCw } from 'lucide-react';
import { publicRentalEndLabel, rentedUntilNow } from '@/lib/public-occupancy';
import { Button } from '@/components/ui/button';

type Occupation = { inicio_at: string; fin_at: string };
type Projection = { ocupaciones: Occupation[]; truncado: boolean; reglas_operativas: string };
const localeCopy = {
  es: ['Ocupación y fechas', 'Próximos 60 días', 'Con ocupación', 'Sin ocupación registrada',
       'Las reglas operativas no están configuradas. No se puede confirmar disponibilidad.',
       'No pudimos consultar la ocupación.', 'Reintentar'],
  en: ['Booked periods', 'Next 60 days', 'Has a booking', 'No recorded booking',
       'Operating rules are not configured. Availability is not confirmed.',
       'Could not check occupancy.', 'Retry'],
  pt: ['Períodos ocupados', 'Próximos 60 dias', 'Com ocupação', 'Sem ocupação registrada',
       'Regras operacionais não configuradas. Disponibilidade não confirmada.',
       'Não foi possível consultar a ocupação.', 'Tentar novamente'],
};
const argToday = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(new Date());
  const p = (key: string) => parts.find(x => x.type === key)?.value || '';
  return p('year')+'-'+p('month')+'-'+p('day');
};
const dayPlus = (s: string, n: number) => {
  const d = new Date(s+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
};
const occupiedDay = (x: Occupation, ymd: string) => {
  const start = Date.parse(ymd+'T03:00:00Z');
  const end = Date.parse(dayPlus(ymd,1)+'T03:00:00Z');
  return Date.parse(x.inicio_at)<end && Date.parse(x.fin_at)>start;
};

export function DisponibilidadPublica({unidadId,locale='es'}:{
  unidadId:string;locale?:string
}) {
  const t = localeCopy[locale as keyof typeof localeCopy] || localeCopy.es;
  const [projection,setProjection] = useState<Projection|null>(null);
  const [state,setState] = useState<'loading'|'error'|'ready'>('loading');
  const [revision,setRevision] = useState(0);
  const [now,setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);
  const days = useMemo(() => {
    const today = argToday();
    return Array.from({length:60},(_,i)=>dayPlus(today,i));
  },[]);
  useEffect(() => {
    const controller = new AbortController();
    setProjection(null);setState('loading');
    fetch((process.env.NEXT_PUBLIC_API_URL || '')+
      '/marketplace/unidades/'+encodeURIComponent(unidadId)+'/disponibilidad', {
      cache:'no-store',signal:controller.signal,
    }).then(async r=>{
      if (!r.ok) throw new Error('request failed');
      const d:Projection = await r.json();
      if (!Array.isArray(d.ocupaciones)||typeof d.truncado!=='boolean')
        throw new Error('invalid response');
      if (!controller.signal.aborted) {setProjection(d);setState('ready');}
    }).catch(()=>{
      if (!controller.signal.aborted)setState('error');
    });
    return ()=>controller.abort();
  },[unidadId,revision]);

  // An exact active interval, not just a busy calendar date, supports the banner.
  // This intentionally does not label a future booking as occupied now.
  const rentalEnd = state === 'ready' && projection
    ? rentedUntilNow(projection.ocupaciones, now, projection.truncado)
    : null;
  const untilLabel = rentalEnd ? publicRentalEndLabel(rentalEnd, locale) : '';
  const occupiedNowText = locale === 'en' ? 'This unit is rented until ' :
    locale === 'pt' ? 'Esta unidade está alugada até ' :
    'Esta unidad se encuentra alquilada hasta el ';
  const stillPublishedText = locale === 'en'
    ? 'The listing remains published. You can ask about other dates.'
    : locale === 'pt'
      ? 'O anúncio continua publicado. Consulte outros períodos.'
      : 'El aviso sigue publicado. Podés consultar por otros períodos.';

  const head=locale==='en'?['M','T','W','T','F','S','S']:locale==='pt'
    ?['S','T','Q','Q','S','S','D']:['L','M','X','J','V','S','D'];
  const offset=(new Date(days[0]+'T00:00:00Z').getUTCDay()+6)%7;
  return <section className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 space-y-3"
    data-testid="disponibilidad-publica">
    <div className="flex items-center gap-2">
      <CalendarDays className="h-5 w-5 text-primary"/>
      <div><h3 className="text-base font-bold">{t[0]}</h3>
        <p className="text-xs text-muted-foreground">{t[1]}</p></div>
    </div>
    {state==='loading'&&<p role="status" className="text-xs">Consultando…</p>}
    {state==='error'&&<div role="alert" className="space-y-2">
      <p className="text-xs text-destructive">{t[5]} {t[4]}</p>
      <Button variant="outline" size="sm" onClick={()=>setRevision(v=>v+1)}>
        <RefreshCw className="h-3 w-3 mr-1"/>{t[6]}
      </Button>
    </div>}
    {state==='ready'&&projection&&<>
      {rentalEnd && <div data-testid="unidad-alquilada-hasta" role="status"
        className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
        <CalendarClock className="h-5 w-5 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" aria-hidden="true"/>
        <div className="space-y-1">
          <p className="text-sm font-bold text-foreground">{occupiedNowText}{untilLabel}</p>
          <p className="text-xs text-muted-foreground">{stillPublishedText}</p>
        </div>
      </div>}
      <div className="flex flex-wrap gap-3 text-[11px]">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-amber-500/25 border border-amber-500/50"/>{t[2]}</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-muted border border-border"/>{t[3]}</span>
      </div>
      <div className="grid grid-cols-7 gap-1 max-w-sm" aria-label={t[0]}>
        {head.map((h,i)=><div key={i} className="text-center text-[10px] font-semibold text-muted-foreground">{h}</div>)}
        {Array.from({length:offset},(_,i)=><span key={'pad'+i} aria-hidden="true"/>)}
        {days.map(day=>{
          const busy=projection.ocupaciones.some(x=>occupiedDay(x,day));
          return <div key={day} title={day+': '+(busy?t[2]:t[3])}
            aria-label={day+': '+(busy?t[2]:t[3])}
            className={'aspect-square flex items-center justify-center rounded-lg border text-[11px] tabular-nums '+
              (busy?'bg-amber-500/20 border-amber-500/30 text-foreground font-semibold':
                'bg-muted/25 border-border/50 text-muted-foreground')}>
            {Number(day.slice(-2))}
          </div>;
        })}
      </div>
      <p className="text-xs text-amber-700 dark:text-amber-300">{t[4]}</p>
      {projection.truncado&&<p role="status" className="text-xs text-destructive">
        Hay más ocupaciones que las mostradas. Consulta parcial.
      </p>}
      <p className="text-[11px] text-muted-foreground">
        {locale==='en'
          ? 'A marked day may contain just a few booked hours, not the entire day.'
          : locale==='pt'
            ? 'Um dia marcado pode ter apenas algumas horas ocupadas.'
            : 'Un día marcado puede tener solo algunas horas ocupadas, no necesariamente el día completo.'}
      </p>
    </>}
  </section>;
}
