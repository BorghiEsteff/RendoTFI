import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerAuth } from '@/lib/supabase/server-auth';
import { getServerAccessContext } from '@/lib/access-context';
import { fetchMisUnidades, fetchMisGrupos } from '@/lib/inventory-loader';
import { InventoryLoadError } from '@/components/gestor/InventoryLoadError';
import GastosOverview, { type PanelUnidad } from '@/components/gestor/GastosOverview';

export const dynamic = 'force-dynamic';
const UNITS_PER_PAGE = 50;

function periodNow(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const result = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return result.year + '-' + result.month;
}

export default async function GastosPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams?: { periodo?: string; page?: string };
}) {
  const store = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return store.getAll(); } } },
  );
  const { user, accessToken } = await getServerAuth(store, supabase);
  if (!user || !accessToken) redirect('/' + locale + '/auth/login');

  const context = await getServerAccessContext(accessToken);
  if (!context || (context.actor === 'delegado' && context.state !== 'activo')) {
    return <InventoryLoadError title="No tenés acceso a Gastos y obligaciones"
      message="Verificá tus permisos de Gestor o el alcance de tu delegación." />;
  }

  const periodo = typeof searchParams?.periodo === 'string' &&
    /^(20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/.test(searchParams.periodo)
    ? searchParams.periodo : periodNow();

  const page = typeof searchParams?.page === 'string' && /^[1-9]\d{0,5}$/.test(searchParams.page)
    ? Number(searchParams.page) : 1;

  const [inventory, groups] = await Promise.all([
    fetchMisUnidades(accessToken, page, UNITS_PER_PAGE),
    fetchMisGrupos(accessToken),
  ]);

  if (!inventory.ok) return <InventoryLoadError title="No se pudieron cargar tus unidades"
    message="No se mostraron gastos ni estados ficticios. Reintentá la consulta." />;

  const unidadIds = inventory.data.map(x => x.id);
  let panel: Record<string, PanelUnidad> = {};
  if (unidadIds.length) {
    try {
      const api = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL;
      if (!api) throw new Error('API no configurada');
      const search = new URLSearchParams({
        ids: unidadIds.join(','), periodo,
      });
      const response = await fetch(api + '/unidades/obligaciones/panel?' + search.toString(), {
        headers: { Authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('Error de API ' + response.status);
      const payload = await response.json() as { periodo?: string; unidades?: Record<string, PanelUnidad> };
      if (payload.periodo !== periodo || !payload.unidades ||
          !unidadIds.every(id => !!payload.unidades?.[id] && Array.isArray(payload.unidades[id].conceptos))) {
        throw new Error('Respuesta del panel incompleta');
      }
      panel = payload.unidades;
    } catch {
      return <InventoryLoadError title="No pudimos consultar los gastos"
        message="La información de las unidades está disponible, pero no se pudieron cargar sus obligaciones. No se mostrará ningún estado inventado." />;
    }
  }

  const names = groups.ok ? new Map(groups.data.map(g => [g.id, g.nombre])) : new Map<string, string>();
  const units = inventory.data.map(u => ({
    id: u.id,
    nombre: u.titulo_es?.trim() || 'Unidad sin título',
    grupo: u.grupo_id ? names.get(u.grupo_id) || null : null,
    categoria: typeof u.categoria === 'string' ? u.categoria : u.categoria?.nombre || null,
    resumen: panel[u.id] || null,
  }));

  return <GastosOverview
    locale={locale}
    periodo={periodo}
    unidades={units}
    page={inventory.page}
    totalUnidades={inventory.count}
    perPage={inventory.limit}
    canManage={context.actor === 'gestor' ||
      (context.actor === 'delegado' && context.state === 'activo' && context.permiso === 'gestionar')}
  />;
}
