import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getServerAuth } from '@/lib/supabase/server-auth';

export default async function DevLayout({
  children,
  params: { locale },
}: { children: ReactNode; params: { locale: string } }) {
  // Beta-only, explicitly enabled on BOTH web and API deployments.
  if (process.env.RENDO_BETA_MODE !== 'true' || process.env.RENDO_DEV_DASHBOARD_ENABLED !== 'true') {
    notFound();
  }

  const supabase = await createClient();
  const { accessToken } = await getServerAuth(cookies(), supabase);
  if (!accessToken) redirect('/' + locale + '/auth/login?next=/' + locale + '/dev/metricas');

  // Backend is the ONLY authority for dev authorization. No client-editable metadata.
  const apiOrigin = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!apiOrigin) notFound();
  let allowed = false;
  try {
    const response = await fetch(apiOrigin + '/dev/me', {
      headers: { Authorization: 'Bearer ' + accessToken },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    allowed = response.ok;
  } catch {
    // Fail closed while the API or database is unavailable.
  }
  if (!allowed) notFound();

  const links = [
    ['metricas', 'Métricas reales'],
    ['moderacion', 'Moderación'],
    ['auditoria-pagos', 'Pagos manuales'],
    ['logs', 'Auditoría global'],
  ];
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/90 px-5 py-5">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-emerald-400">RENDO OPS / BETA</p>
            <h1 className="text-2xl font-bold">Consola de desarrollo · Superadmin</h1>
            <p className="text-xs text-slate-400">Cuenta única · datos reales · acciones auditadas</p>
          </div>
          <Link href={'/' + locale + '/unidades'} className="text-sm text-slate-300 hover:text-white">
            Volver a Rendo
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl grid gap-6 p-4 md:grid-cols-[230px_1fr] md:p-6">
        <nav aria-label="Secciones de la consola" className="flex flex-wrap content-start gap-2 md:flex-col">
          {links.map(([slug, label]) => (
            <Link key={slug} href={'/' + locale + '/dev/' + slug}
              className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200 hover:border-emerald-500 hover:text-white">
              {label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
