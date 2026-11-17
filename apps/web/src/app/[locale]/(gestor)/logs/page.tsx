import { createServerClient } from '@supabase/ssr';
import { getServerAuth } from '@/lib/supabase/server-auth';
import { getServerAccessContext } from '@/lib/access-context';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LogsClientView, { type LogEntry } from './LogsClientView';
import { ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 50;

type RawAuditEvent = {
  id: string;
  actor_id: string;
  actor_rol: string;
  actor_nombre?: string | null;
  objetivo_nombre?: string | null;
  recurso_nombre?: string | null;
  accion: string;
  recurso_tipo: string;
  recurso_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export default async function LogsPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const locale = params.locale;
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    },
  );

  const { user, accessToken } = await getServerAuth(cookieStore, supabase);
  if (!user) redirect('/' + locale + '/auth/login');

  // La autorización siempre se basa en el contexto verificado, nunca en user_metadata
  // ni en coincidencias de texto del email.
  const accessContext = await getServerAccessContext(accessToken);
  if (accessContext?.actor === 'delegado') {
    return (
      <div data-testid="owner-only-forbidden" className="max-w-xl mx-auto my-12 p-8 rounded-2xl border border-border text-center">
        <ShieldAlert className="w-12 h-12 mx-auto text-amber-600 mb-3" />
        <h1 className="text-2xl font-semibold mb-2">Acceso exclusivo del Gestor</h1>
        <p className="text-sm text-muted-foreground">El historial completo de actividad solo está disponible para el Gestor titular.</p>
      </div>
    );
  }
  if (!accessToken || accessContext?.actor !== 'gestor') {
    return <LogsClientView initialError locale={locale} />;
  }

  const pageValue = typeof searchParams?.page === 'string' ? searchParams.page : '1';
  const page = /^[1-9]\d*$/.test(pageValue) ? Math.min(100000, Number(pageValue)) : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return <LogsClientView initialError locale={locale} />;

  try {
    const response = await fetch(apiUrl + '/logs?limit=' + PAGE_SIZE + '&offset=' + offset, {
      headers: { Authorization: 'Bearer ' + accessToken },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('Falló la consulta de auditoría');

    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
      throw new Error('La API devolvió un formato de auditoría inválido');
    }
    const raw = body as { data: RawAuditEvent[]; total?: number };
    const logs: LogEntry[] = raw.data.map(event => ({
      id: event.id,
      actorId: event.actor_id,
      actorNombre: event.actor_nombre || null,
      actorRol: event.actor_rol,
      accion: event.accion,
      entidadTipo: event.recurso_tipo,
      entidadRef: event.recurso_id || null,
      recursoNombre: event.recurso_nombre || null,
      objetivoNombre: event.objetivo_nombre || null,
      metadata: event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {},
      fecha: event.created_at,
    }));
    const total = Number.isSafeInteger(raw.total) && (raw.total as number) >= 0 ? raw.total! : logs.length;
    return <LogsClientView locale={locale} initialLogs={logs} total={total} currentPage={page} pageSize={PAGE_SIZE} />;
  } catch {
    return <LogsClientView initialError locale={locale} />;
  }
}
