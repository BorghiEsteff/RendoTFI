'use client';

import React, { useEffect, useState } from 'react';
import { ReceivedInvitation } from '@tfi/types';
import { getDelegationAccessToken } from '@/lib/delegation-auth';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Mail, Check, X, AlertCircle, Clock, Building2 } from 'lucide-react';

interface InvitationInboxProps {
  initialInvitations?: ReceivedInvitation[];
}

export function InvitationInbox({ initialInvitations }: InvitationInboxProps) {
  const router = useRouter();
  const locale = useLocale();
  const [accepted, setAccepted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<ReceivedInvitation[]>(
    initialInvitations || [],
  );
  const [loading, setLoading] = useState(!initialInvitations);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchInvitations = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getDelegationAccessToken();
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
      const res = await fetch('/api/delegados/invitaciones/recibidas', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        throw new Error('No pudimos consultar las invitaciones. Reintenta o vuelve a iniciar sesión.');
      }
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error('El servidor devolvió una lista de invitaciones inválida');
      setInvitations(data as ReceivedInvitation[]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar las invitaciones';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialInvitations) {
      fetchInvitations();
    }
  }, [initialInvitations]);

  const handleAccept = async (id: string) => {
    setProcessingId(id);
    setActionError(null);
    try {
      const token = await getDelegationAccessToken();
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
      const res = await fetch(`/api/delegados/invitaciones/${id}/aceptar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'No se pudo aceptar la invitación');
      }
      setInvitations((prev) => prev.filter((inv) => inv.id !== id));
      setAccepted(true);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al aceptar la invitación';
      setActionError(msg);
    }
  };

  const handleReject = async (id: string) => {
    setActionError(null);
    if (!confirm('¿Estás seguro de que deseas rechazar esta invitación?')) return;
    setProcessingId(id);
    try {
      const token = await getDelegationAccessToken();
      if (!token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
      const res = await fetch(`/api/delegados/invitaciones/${id}/rechazar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('No se pudo rechazar la invitación');
      }
      setInvitations((prev) => prev.filter((i) => i.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al rechazar la invitación';
      setActionError(msg);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div data-testid="invitation-inbox-loading" className="space-y-4 py-8">
        <div className="h-6 w-48 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
        <div className="h-28 w-full bg-slate-100 dark:bg-[#182747] animate-pulse rounded-xl border border-slate-200 dark:border-[#293956]" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="invitation-inbox-error"
        className="p-6 rounded-xl border border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300 my-4"
      >
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="font-medium text-sm">{error}</p>
        </div>
        <button
          onClick={fetchInvitations}
          className="mt-3 px-4 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (accepted && invitations.length === 0) {
    return (
      <div role="status" data-testid="invitation-accepted" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6 space-y-3">
        <h3 className="font-semibold">Invitación aceptada</h3>
        <p className="text-sm">Ya formas parte del equipo. Por seguridad, no tendrás acceso a las unidades hasta que el gestor confirme tus permisos.</p>
        <a className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-primary-foreground" href={`/${locale}/dashboard`}>Ir a mi panel</a>
      </div>
    );
  }

  if (invitations.length === 0 && !actionError) {
    return (
      <div
        data-testid="empty-invitaciones"
        className="text-center py-12 px-4 rounded-xl border border-dashed border-[#D9D5CC] dark:border-[#293956] bg-white/50 dark:bg-[#182747]/40"
      >
        <Mail className="w-12 h-12 mx-auto text-[#B8BFCC] mb-3" />
        <h3 className="text-base font-semibold text-[#131F3C] dark:text-[#F5F3EE]">
          No tienes invitaciones pendientes
        </h3>
        <p className="text-xs text-[#667085] dark:text-[#AEB7C7] mt-1 max-w-sm mx-auto">
          Cuando un Gestor inmobiliario te invite a colaborar como Delegado en su espacio de trabajo, aparecerá aquí.
        </p>
        <button type="button" onClick={() => void fetchInvitations()} data-testid="btn-refrescar-invitaciones"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted">
          Actualizar invitaciones
        </button>
      </div>
    );
  }

  return (
    <div data-testid="invitation-inbox" className="space-y-4">
      {actionError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{actionError}</div>}
      {accepted && <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">Invitación aceptada. El gestor debe configurar tus permisos antes de que tengas acceso. <a href={`/${locale}/dashboard`} className="underline">Ir al panel</a>.</div>}
      {invitations.map((inv) => {
        const rawInv = inv as unknown as Record<string, unknown>;
        const expiresAt = inv.expiresAt || (rawInv.expiraEn as string) || Date.now();
        const isExpired = inv.estado === 'expirada' || new Date(expiresAt) < new Date();
        const gestorName = inv.gestorDisplayName || (rawInv.gestorNombre as string) || 'Gestor Inmobiliario';
        return (

          <div
            key={inv.id}
            data-testid={`invitation-item-${inv.id}`}
            className="p-5 rounded-xl border border-[#D9D5CC] dark:border-[#293956] bg-white dark:bg-[#182747] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#B89355]" />
                <span className="font-semibold text-sm text-[#131F3C] dark:text-[#F5F3EE]">
                  {gestorName}
                </span>
                {isExpired && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400">
                    Expirada
                  </span>
                )}
              </div>
              <p className="text-xs text-[#667085] dark:text-[#AEB7C7]">
                Te ha invitado a colaborar como Delegado en su espacio de gestión.
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-[#667085] dark:text-[#AEB7C7] pt-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Expira el {new Date(expiresAt).toLocaleDateString('es-AR')}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 md:pt-0">
              <button
                data-testid="btn-rechazar-invitacion"
                onClick={() => handleReject(inv.id)}
                disabled={processingId === inv.id}
                className="px-4 py-2 min-h-[44px] min-w-[44px] text-xs font-semibold rounded-lg border border-rose-500/60 text-rose-600 dark:text-rose-200 bg-transparent dark:bg-rose-950/30 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Rechazar
              </button>
              <button
                data-testid="btn-aceptar-invitacion"
                onClick={() => handleAccept(inv.id)}
                disabled={processingId === inv.id || isExpired}
                className="px-4 py-2 min-h-[44px] min-w-[44px] text-xs font-bold rounded-lg bg-[#B89355] text-[#131F3C] hover:bg-[#9F783E] hover:text-[#0B1428] transition disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                {processingId === inv.id ? 'Aceptando...' : 'Aceptar'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

