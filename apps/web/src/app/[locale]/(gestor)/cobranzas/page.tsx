import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getServerAuth } from '@/lib/supabase/server-auth';
import { getServerAccessContext } from '@/lib/access-context';
import { InventoryLoadError } from '@/components/gestor/InventoryLoadError';
import { CobranzasView, type Cuota, type AlquilerDisponible } from '@/components/gestor/CobranzasView';

export const dynamic = 'force-dynamic';

export default async function CobranzasPage() {
  const store = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {cookies: {get(name: string) {return store.get(name)?.value;}}},
  );
  const {accessToken: token} = await getServerAuth(store, supabase);
  const context = await getServerAccessContext(token);
  let cuotas: Cuota[] = [];
  let total = 0;
  let alquileres: AlquilerDisponible[] = [];
  let failed = !token || !context;

  if (!failed) {
    try {
      const options = {
        headers: {Authorization: 'Bearer ' + token},
        cache: 'no-store' as RequestCache,
        signal: AbortSignal.timeout(12000),
      };
      const [cuotasRes, rentalsRes] = await Promise.all([
        fetch((process.env.NEXT_PUBLIC_API_URL || '') + '/cobranzas?limit=500',options),
        fetch((process.env.NEXT_PUBLIC_API_URL || '') + '/alquileres?limit=1000',options),
      ]);
      if (!cuotasRes.ok || !rentalsRes.ok) throw new Error('Servicio administrativo no disponible');
      const [ledger, rentals]: unknown[] = await Promise.all([cuotasRes.json(), rentalsRes.json()]);
      if (!ledger || typeof ledger !== 'object' ||
          !Array.isArray((ledger as {data?: unknown}).data) ||
          !rentals || typeof rentals !== 'object' ||
          !Array.isArray((rentals as {data?: unknown}).data)) throw new Error('Respuesta inválida');
      cuotas = (ledger as {data: Cuota[]}).data;
      total = Number((ledger as {total?: number}).total || 0);
      alquileres = (rentals as {data: AlquilerDisponible[]}).data;
    } catch {
      failed = true;
    }
  }

  if (failed) {
    return <div data-testid="cobranzas-load-error" className="max-w-2xl">
      <InventoryLoadError
        title={token ? 'No pudimos consultar las cuentas corrientes' : 'Iniciá sesión para consultar tus cobros'}
        message="No se registró ni eliminó ningún cobro. Verificá tu conexión y volvé a intentarlo."
      />
    </div>;
  }

  const canManage = context?.actor === 'gestor' ||
    (context?.actor === 'delegado' && context.state === 'activo' && context.permiso === 'gestionar');
  return <CobranzasView cuotas={cuotas} totalCuotas={total}
    alquileres={alquileres} token={token!} canManage={canManage}/>;
}
