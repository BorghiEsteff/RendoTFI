'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useForm, Controller, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { addDays, addMonths, format, isBefore, startOfDay } from 'date-fns';
import { useRouter } from 'next/navigation';
import { getClientAuthToken } from '@/lib/supabase/client-token';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { InquilinoFormModal } from '@/components/gestor/InquilinoFormModal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Plus,
  FileText,
  AlertCircle,
  Wallet,
  ShieldCheck,
  ArrowRightLeft,
  DollarSign,
  Clock,
  Calendar,
  Layers,
} from 'lucide-react';
import type { RentalModality } from '@tfi/types';
import {
  getModeTariff,
  normalizeTariffMode,
  rentalAmount,
  rentalQuantity,
  toArgentinaMidnight,
  toArgentinaHourlyInterval,
} from './rental-wizard-pricing';

const formSchema = z
  .object({
    unidad_id: z.string().min(1, 'Seleccione una unidad'),
    inquilino_id: z.string().min(1, 'Seleccione un inquilino'),
    modalidad: z.enum(['mensual', 'diaria', 'por_hora'], {
      message: 'La modalidad es requerida',
    }),
    fecha_inicio: z.date({
      message: 'La fecha de inicio es requerida',
    }),
    fecha_fin: z.date({
      message: 'La fecha de fin es requerida',
    }),
    hora_inicio: z.string().optional(),
    hora_fin: z.string().optional(),
    monto_total: z.number().min(0.01, 'El monto total debe ser mayor a 0'),
    tarifa_base: z.number().min(0, 'La tarifa no puede ser negativa'),
    cargos_extra: z.number().min(0, 'Los cargos adicionales no pueden ser negativos'),
    descuento: z.number().min(0, 'El descuento no puede ser negativo'),
    dia_vencimiento: z.number().int().min(1).max(31),
    ajuste_porcentaje: z.number().min(0).max(100),
    ajuste_cada_meses: z.number().int().min(1).max(60),
    deposito_recibido: z.boolean(),
    sena_eleccion: z.enum(['sin_sena', 'heredar_grupo', 'personalizada']),
    sena_tipo: z.enum(['porcentaje', 'monto_fijo']).optional(),
    sena_valor: z.number().optional(),
    monto_sena: z.number().min(0, 'La seña no puede ser negativa').optional(),
    monto_deposito: z.number().min(0, 'El depósito no puede ser negativo').optional(),
    estado_pago: z.enum(['cobrado_total', 'seña_cobrada', 'pendiente']),
    observaciones: z.string().optional(),
  })
  .refine(
    (data) => !isBefore(startOfDay(data.fecha_inicio), startOfDay(new Date())),
    {
      message: 'La fecha de inicio no puede ser anterior a hoy',
      path: ['fecha_inicio'],
    },
  )
  .refine(
    (data) => {
      if (data.modalidad === 'por_hora') return !!data.hora_inicio && !!data.hora_fin && data.hora_inicio !== data.hora_fin;
      return isBefore(startOfDay(data.fecha_inicio), startOfDay(data.fecha_fin));
    },
    {
      message: 'La fecha de fin debe ser posterior a la fecha de inicio',
      path: ['fecha_fin'],
    },
  )
  .refine(
    (data) => {
      if (data.sena_eleccion === 'personalizada') {
        if (!data.sena_tipo) return false;
        if (data.sena_valor === undefined || data.sena_valor === null || isNaN(data.sena_valor) || data.sena_valor <= 0) {
          return false;
        }
        if (data.sena_tipo === 'porcentaje' && data.sena_valor > 100) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'El valor de la seña debe ser mayor a 0 (y hasta 100% si es porcentaje)',
      path: ['sena_valor'],
    },
  )
  .refine(
    (data) => {
      if (data.sena_eleccion === 'personalizada' && data.sena_tipo === 'monto_fijo') {
        const val = data.sena_valor || 0;
        const total = data.monto_total || 0;
        if (val > total && total > 0) return false;
      }
      const sena = data.monto_sena || 0;
      const total = data.monto_total || 0;
      if (sena > 0 && total > 0) {
        return sena <= total;
      }
      return true;
    },
    {
      message: 'La seña no puede superar el monto total acordado',
      path: ['sena_valor'],
    },
  );

type FormData = z.infer<typeof formSchema>;

export interface UnidadOption {
  id: string;
  titulo_es?: string;
  categoria?: string;
  grupo_id?: string | null;
  modalidades_precio?: Array<{
    id?: string;
    unidad_tiempo: string;
    cantidad_tiempo?: number;
    precio?: number;
  }>;
}

export interface InquilinoOption {
  id: string;
  nombre_completo: string;
  email?: string;
  documento?: string;
}

export interface GrupoOption {
  id: string;
  nombre: string;
  sena_default_activa?: boolean;
  sena_default_tipo?: 'porcentaje' | 'monto_fijo';
  sena_default_valor?: number;
  sena_porcentaje?: number;
  sena_default?: number;
}

export interface AlquilerFormModalProps {
  token: string;
  unidades: UnidadOption[];
  inquilinos: InquilinoOption[];
  grupos?: GrupoOption[];
}

export function AlquilerFormModal({
  token,
  unidades,
  inquilinos,
  grupos = [],
}: AlquilerFormModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const continueEditingRef = useRef<HTMLButtonElement>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [apiErrorMessage, setApiErrorMessage] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [attemptedAdvance, setAttemptedAdvance] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [manualAmount, setManualAmount] = useState(false);
  const [unitDetail, setUnitDetail] = useState<UnidadOption | null>(null);
  const [unitDetailLoading, setUnitDetailLoading] = useState(false);
  const [unitDetailError, setUnitDetailError] = useState(false);
  const [tenantCreationFeedback, setTenantCreationFeedback] = useState<string | null>(null);

  const [unidadesList, setUnidadesList] = useState<UnidadOption[]>(unidades);
  const [inquilinosList, setInquilinosList] = useState<InquilinoOption[]>(inquilinos);
  const mergeInquilinos = useCallback((incoming: InquilinoOption[]) => {
    setInquilinosList((current) => {
      const byId = new Map(current.map((tenant) => [tenant.id, tenant]));
      for (const tenant of incoming) {
        if (tenant.id) byId.set(tenant.id, tenant);
      }
      return Array.from(byId.values());
    });
  }, []);
  const [gruposList, setGruposList] = useState<GrupoOption[]>(grupos);

  // Estado para el archivo PDF del contrato

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      unidad_id: '',
      inquilino_id: '',
      modalidad: 'mensual',
      fecha_inicio: new Date(),
      fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      hora_inicio: '10:00',
      hora_fin: '14:00',
      monto_total: 0, // Solo tarifas reales; no se inventa un precio.
      tarifa_base: 0,
      cargos_extra: 0,
      descuento: 0,
      dia_vencimiento: 10,
      ajuste_porcentaje: 0,
      ajuste_cada_meses: 12,
      deposito_recibido: false,
      sena_eleccion: 'sin_sena',
      sena_tipo: 'monto_fijo',
      sena_valor: 0,
      monto_sena: 0,
      monto_deposito: 0,
      estado_pago: 'pendiente',
      observaciones: '',
    },
  });

  // Capture the actual baseline when the dialog opens (not at mount), so
  // every form change, including setValue/select changes, is accounted for.
  const openSnapshotRef = useRef('');
  useEffect(() => {
    if (confirmDiscard) continueEditingRef.current?.focus();
  }, [confirmDiscard]);

  const watchedModalidad = form.watch('modalidad');
  const watchedFechaInicio = form.watch('fecha_inicio');
  const minimumStartDate = startOfDay(new Date());
  const minimumEndDate = watchedModalidad === 'por_hora'
    ? startOfDay(watchedFechaInicio || minimumStartDate)
    : addDays(startOfDay(watchedFechaInicio || minimumStartDate), 1);
  const watchedUnidadId = form.watch('unidad_id');
  const watchedTotal = form.watch('monto_total') || 0;
  const watchedTarifa = form.watch('tarifa_base') || 0;
  const watchedExtras = form.watch('cargos_extra') || 0;
  const watchedDescuento = form.watch('descuento') || 0;
  const watchedFechaFin = form.watch('fecha_fin');
  const watchedHoraInicio = form.watch('hora_inicio') || '';
  const watchedHoraFin = form.watch('hora_fin') || '';
  const watchedGarantiaRecibida = form.watch('deposito_recibido');
  const watchedVencimiento = form.watch('dia_vencimiento');
  const watchedAjuste = form.watch('ajuste_porcentaje');
  const watchedSena = form.watch('monto_sena') || 0;
  const watchedDeposito = form.watch('monto_deposito') || 0;
  const watchedEstadoPago = form.watch('estado_pago');
  const watchedSenaEleccion = form.watch('sena_eleccion');
  const watchedSenaTipo = form.watch('sena_tipo');
  const watchedSenaValor = form.watch('sena_valor');

  // Buscar unidad seleccionada
  const selectedUnidad = useMemo(() => {
    if (unitDetail?.id === watchedUnidadId) return unitDetail;
    return unidadesList.find((u) => u.id === watchedUnidadId) || null;
  }, [unidadesList, unitDetail, watchedUnidadId]);

  // Fetch authoritative tariff details for the selected unit. The lightweight
  // /unidades listing intentionally excludes the related price rows.
  useEffect(() => {
    setUnitDetail(null);
    setUnitDetailError(false);
    if (!watchedUnidadId) return;
    const ctrl = new AbortController();
    const effectiveToken = getClientAuthToken(token);
    setUnitDetailLoading(true);
    fetch((process.env.NEXT_PUBLIC_API_URL || '') + '/unidades/' + watchedUnidadId, {
      headers: { Authorization: 'Bearer ' + effectiveToken },
      cache: 'no-store',
      signal: ctrl.signal,
    }).then(async (res) => {
      if (!res.ok) throw new Error('No se pudieron consultar las tarifas de la unidad');
      const detail = await res.json() as UnidadOption;
      if (detail.id !== watchedUnidadId || !Array.isArray(detail.modalidades_precio)) {
        throw new Error('La unidad no devolvió modalidades válidas');
      }
      if (!ctrl.signal.aborted) setUnitDetail(detail);
    }).catch(() => {
      if (!ctrl.signal.aborted) setUnitDetailError(true);
    }).finally(() => {
      if (!ctrl.signal.aborted) setUnitDetailLoading(false);
    });
    return () => ctrl.abort();
  }, [watchedUnidadId, token]);

  const quantity = rentalQuantity(
    watchedModalidad, watchedFechaInicio, watchedFechaFin,
    watchedHoraInicio, watchedHoraFin,
  );
  const tariffSuggestion = getModeTariff(selectedUnidad?.modalidades_precio, watchedModalidad);
  const availableModalities = (selectedUnidad?.modalidades_precio || [])
    .filter((t) => !t.deleted_at)
    .map((t) => normalizeTariffMode(t.unidad_tiempo))
    .filter((m): m is RentalModality => m !== null);
  const selectedModeOffered = !unitDetail || availableModalities.includes(watchedModalidad);

  useEffect(() => {
    if (!watchedUnidadId || unitDetail?.id !== watchedUnidadId) return;
    form.setValue('tarifa_base', tariffSuggestion ?? 0);
  }, [watchedUnidadId, watchedModalidad, tariffSuggestion, unitDetail, form]);

  useEffect(() => {
    if (manualAmount) return;
    form.setValue('monto_total', rentalAmount(quantity, watchedTarifa, watchedExtras, watchedDescuento), {
      shouldValidate: form.formState.isSubmitted,
    });
  }, [quantity, watchedTarifa, watchedExtras, watchedDescuento, manualAmount, form]);

  const totalRegister = form.register('monto_total', { valueAsNumber: true });
  const amountCurrency = (value: number) => '$' + Number(value || 0).toLocaleString('es-AR');


