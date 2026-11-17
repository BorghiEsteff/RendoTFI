import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { getServerAuth } from '@/lib/supabase/server-auth';
import { getServerAccessContext } from '@/lib/access-context';
import ObligacionesClient, { type DatosObligaciones } from '@/components/gestor/ObligacionesClient';

export const dynamic = 'force-dynamic';

function periodoLocal() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return p.year + '-' + p.month;
}

export default async function UnidadObligacionesPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  const { locale, id } = params;
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); } } },
  );
  const { user, accessToken } = await getServerAuth(cookieStore, supabase);
  if (!user || !accessToken) redirect('/' + locale + '/auth/login');
  const accessContext = await getServerAccessContext(accessToken);
  if (!accessContext || (accessContext.actor === 'delegado' && accessContext.state !== 'activo')) {
    return <main className="max-w-2xl mx-auto p-6">
      <ShieldAlert className="h-8 w-8 mb-3 text-amber-600" />
      <h1 className="text-xl font-semibold">Sin acceso a esta unidad</h1>
      <p className="text-sm text-muted-foreground">Consultá con el Gestor para obtener permisos sobre la unidad.</p>
    </main>;
  }

  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    return <div role="alert" className="max-w-3xl mx-auto p-6">
      No se pudo conectar al servicio de gastos. La configuración de la API no está disponible.
    </div>;
  }
  const headers = { Authorization: 'Bearer ' + accessToken };
  const month = periodoLocal();
  try {
    const [unidadResponse, obligationsResponse] = await Promise.all([
      fetch(base + '/unidades/' + encodeURIComponent(id), { headers, cache: 'no-store' }),
      fetch(base + '/unidades/' + encodeURIComponent(id) + '/obligaciones?periodo=' + month,
        { headers, cache: 'no-store' }),
    ]);
    if (unidadResponse.status === 404 || obligationsResponse.status === 404) {
      redirect('/' + locale + '/mis-unidades');
    }
    if (!unidadResponse.ok || !obligationsResponse.ok) throw new Error('Backend no disponible');
    const unidad = await unidadResponse.json() as { titulo_es?: string };
    const data = await obligationsResponse.json() as DatosObligaciones;
    if (!Array.isArray(data.obligaciones) || !Array.isArray(data.periodos) || !data.resumen) {
      throw new Error('Formato inválido de la API');
    }
    const canEdit = accessContext.actor === 'gestor' ||
      (accessContext.actor === 'delegado' && accessContext.state === 'activo' && accessContext.permiso === 'gestionar');
    return <ObligacionesClient unidadId={id} nombreUnidad={unidad.titulo_es || 'Unidad sin título'}
      locale={locale} token={accessToken} initialData={data} canEdit={canEdit} />;
  } catch (err) {
    // Next.js redirects are control-flow exceptions: don't consume them here.
    if (err && typeof err === 'object' && 'digest' in err && String((err as {digest:string}).digest).startsWith('NEXT_REDIRECT')) throw err;
    return <main className="max-w-3xl mx-auto p-6 space-y-3" role="alert">
      <h1 className="text-xl font-semibold">No se pudieron cargar los gastos de la unidad</h1>
      <p className="text-sm text-muted-foreground">No se mostraron importes ni estados inventados. Revisá la conexión o la migración pendiente de la base de datos.</p>
      <Link className="text-primary underline underline-offset-4" href={'/' + locale + '/mis-unidades'}>Volver a mis unidades</Link>
    </main>;
  }
}
