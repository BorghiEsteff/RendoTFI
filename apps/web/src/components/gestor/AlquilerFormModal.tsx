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
    deleted_at?: string | null;
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
      fecha_fin: addMonths(new Date(), 1),
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
  useEffect(() => {
    if (watchedDeposito <= 0 && form.getValues('deposito_recibido')) {
      form.setValue('deposito_recibido', false, { shouldDirty: true });
    }
  }, [watchedDeposito, form]);
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


  // Resolver UNICAMENTE el grupo de la unidad seleccionada (nunca inventar ni caer al primero)
  const selectedGrupo = useMemo(() => {
    if (!selectedUnidad?.grupo_id) {
      return null;
    }
    return gruposList.find((g) => g.id === selectedUnidad.grupo_id) || null;
  }, [selectedUnidad, gruposList]);

  // Disponibilidad estricta de seña por defecto del grupo
  const isGrupoDefaultAvailable = useMemo(() => {
    if (!selectedGrupo || !selectedGrupo.sena_default_activa) return false;
    const valor = Number(selectedGrupo.sena_default_valor ?? selectedGrupo.sena_porcentaje ?? 0);
    if (valor <= 0) return false;
    const tipo = selectedGrupo.sena_default_tipo || 'porcentaje';
    if (tipo === 'porcentaje' && valor > 100) return false;
    return true;
  }, [selectedGrupo]);

  // Si la unidad cambia y ya no hay grupo válido disponible, pasar a sin_sena de forma segura
  useEffect(() => {
    if (form.getValues('sena_eleccion') === 'heredar_grupo' && !isGrupoDefaultAvailable) {
      form.setValue('sena_eleccion', 'sin_sena');
      form.setValue('sena_tipo', 'monto_fijo');
      form.setValue('sena_valor', 0);
      form.setValue('monto_sena', 0);
    }
  }, [isGrupoDefaultAvailable, watchedUnidadId, form]);

  // Mantener sincronizado monto_sena cuando cambia el total del contrato
  useEffect(() => {
    const eleccion = form.getValues('sena_eleccion');
    if (eleccion === 'heredar_grupo' && selectedGrupo && isGrupoDefaultAvailable) {
      const tipo = selectedGrupo.sena_default_tipo || 'porcentaje';
      const val = Number(selectedGrupo.sena_default_valor ?? selectedGrupo.sena_porcentaje ?? 0);
      const calculated = tipo === 'porcentaje' ? Math.round((watchedTotal * val) / 100) : val;
      form.setValue('monto_sena', calculated);
    } else if (eleccion === 'personalizada') {
      const tipo = form.getValues('sena_tipo');
      const val = Number(form.getValues('sena_valor') || 0);
      if (tipo === 'porcentaje') {
        form.setValue('monto_sena', Math.round((watchedTotal * val) / 100));
      } else {
        form.setValue('monto_sena', val);
      }
    }
  }, [watchedTotal, selectedGrupo, isGrupoDefaultAvailable, form]);

  // Cargar grupos si no vinieron en props
  useEffect(() => {
    if (grupos.length > 0) {
      setGruposList(grupos);
    } else {
      const effectiveToken = getClientAuthToken(token);
      const headers: Record<string, string> = {};
      if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      fetch(`${apiUrl}/grupos`, { headers })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setGruposList(data);
        })
        .catch(() => {});
    }
  }, [grupos, token]);

  // Sincronizar unidades si vienen vacías
  useEffect(() => {
    if (unidades.length > 0) {
      setUnidadesList(unidades);
    } else {
      const effectiveToken = getClientAuthToken(token);
      const headers: Record<string, string> = {};
      if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      fetch(`${apiUrl}/unidades?limit=1000`, { headers })
        .then((r) => r.json())
        .then((json) => {
          if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
            setUnidadesList(json.data);
          }
        })
        .catch(() => {});
    }
  }, [unidades, token, form]);

  // Sincronizar inquilinos si vienen vacíos
  useEffect(() => {
    if (inquilinos.length > 0) {
      mergeInquilinos(inquilinos);
    } else {
      const effectiveToken = getClientAuthToken(token);
      const headers: Record<string, string> = {};
      if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      fetch(`${apiUrl}/inquilinos?limit=1000`, { headers })
        .then((r) => r.json())
        .then((json) => {
          if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
            mergeInquilinos(json.data);
          }
        })
        .catch(() => {});
    }
  }, [inquilinos, token, mergeInquilinos]);

  const resetAndClose = () => {
    form.reset();
    setConfirmDiscard(false);
    setSuccessMessage(null);
    setApiErrorMessage(null);
    setTenantCreationFeedback(null);
    setWizardError(null);
    setWizardStep(1);
    setAttemptedAdvance(false);
    setManualAmount(false);
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      openSnapshotRef.current = JSON.stringify(form.getValues());
      setConfirmDiscard(false);
      setOpen(true);
      return;
    }
    // Do not dismiss while the network request is saving the contract.
    if (isSubmitting) return;
    if (!successMessage && JSON.stringify(form.getValues()) !== openSnapshotRef.current) {
      setConfirmDiscard(true);
      return;
    }
    resetAndClose();
  };

  // Cambio de modalidad con ajuste dinámico de fechas/tiempos
  const handleModalityChange = (newMod: RentalModality) => {
    form.setValue('modalidad', newMod, { shouldValidate: true });
    setManualAmount(false);
    setWizardError(null);
    const now = new Date();
    if (newMod === 'mensual') {
      form.setValue('fecha_inicio', now);
      form.setValue('fecha_fin', addMonths(now, 1));
    } else if (newMod === 'diaria') {
      form.setValue('fecha_inicio', now);
      form.setValue('fecha_fin', new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000));
    } else if (newMod === 'por_hora') {
      form.setValue('fecha_inicio', now);
      form.setValue('fecha_fin', now);
      form.setValue('hora_inicio', '10:00');
      form.setValue('hora_fin', '14:00');
    }
  };

  // Cálculo de caja
  let cobradoInicial = 0;
  if (watchedEstadoPago === 'cobrado_total') {
    cobradoInicial = watchedTotal;
  } else if (watchedEstadoPago === 'seña_cobrada') {
    cobradoInicial = watchedSena;
  } else {
    cobradoInicial = 0;
  }
  const saldoPendiente = Math.max(0, watchedTotal - cobradoInicial);
  const fondosCustodia = watchedGarantiaRecibida ? watchedDeposito : 0;

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    setApiErrorMessage(null);

    try {
      // The private contratos bucket authorizes uploads only after an alquiler
      // exists, under its UUID folder. Attach the PDF from the rentals list.\n\n      // 2. Construcción de intervalos según modalidad
      let inicioAtStr: string;
      let finAtStr: string;

      if (data.modalidad === 'por_hora') {
        const hStart = data.hora_inicio || '10:00';
        const hEnd = data.hora_fin || '14:00';

        const interval = toArgentinaHourlyInterval(data.fecha_inicio, hStart, hEnd);
        inicioAtStr = interval.inicio;
        finAtStr = interval.fin;
      } else {
        inicioAtStr = toArgentinaMidnight(data.fecha_inicio);
        finAtStr = toArgentinaMidnight(data.fecha_fin);
      }

      // 3. Preparación de payload de seña coherente y verídico
      let senaTipoPayload: 'porcentaje' | 'monto_fijo' | null = null;
      let senaValorPayload: number | null = null;
      let montoSenaPayload = 0;

      if (data.sena_eleccion === 'personalizada') {
        senaTipoPayload = data.sena_tipo || 'monto_fijo';
        senaValorPayload = Number(data.sena_valor || 0);
        montoSenaPayload = senaTipoPayload === 'porcentaje'
          ? Math.round((Number(data.monto_total) * senaValorPayload) / 100)
          : senaValorPayload;
      } else if (data.sena_eleccion === 'heredar_grupo') {
        senaTipoPayload = null;
        senaValorPayload = null;
        if (selectedGrupo && isGrupoDefaultAvailable) {
          const tipo = selectedGrupo.sena_default_tipo || 'porcentaje';
          const val = Number(selectedGrupo.sena_default_valor ?? selectedGrupo.sena_porcentaje ?? 0);
          montoSenaPayload = tipo === 'porcentaje'
            ? Math.round((Number(data.monto_total) * val) / 100)
            : val;
        }
      } else {
        // sin_sena
        senaTipoPayload = null;
        senaValorPayload = null;
        montoSenaPayload = 0;
      }

      // 4. Envío a API
      const effectiveToken = getClientAuthToken(token);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/alquileres`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({
          unidad_id: data.unidad_id,
          inquilino_id: data.inquilino_id,
          modalidad: data.modalidad,
          inicio_at: inicioAtStr,
          fin_at: finAtStr,
          fecha_inicio: data.fecha_inicio.toISOString(),
          fecha_fin: data.fecha_fin.toISOString(),
          monto_total: Number(data.monto_total || 0),
          sena_eleccion: data.sena_eleccion,
          sena_tipo: senaTipoPayload,
          sena_valor: senaValorPayload,
          monto_sena: montoSenaPayload,
          monto_deposito: Number(data.monto_deposito || 0),
          deposito_recibido: data.deposito_recibido,
          detalle_precio: {
            modalidad: data.modalidad,
            cantidad: rentalQuantity(data.modalidad, data.fecha_inicio, data.fecha_fin, data.hora_inicio || '', data.hora_fin || ''),
            tarifa_base: Number(data.tarifa_base || 0),
            cargos_extra: Number(data.cargos_extra || 0),
            descuento: Number(data.descuento || 0),
            importe_calculado: Number(data.monto_total),
            origen: manualAmount ? 'manual' : 'automatico',
            ...(data.modalidad === 'mensual' ? {
              dia_vencimiento: data.dia_vencimiento,
              ajuste_porcentaje: data.ajuste_porcentaje,
              ajuste_cada_meses: data.ajuste_cada_meses,
            } : {}),
          },
          estado_pago: data.estado_pago,
          observaciones: data.observaciones,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Error al crear el alquiler (${res.status})`);
      }

      setSuccessMessage('¡Alquiler registrado con éxito!');
      setWizardStep(1);
      form.reset();
      router.refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error inesperado al registrar el alquiler';
      setApiErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInvalid = (errors: FieldErrors<FormData>) => {
    const order: (keyof FormData)[] = [
      'unidad_id', 'inquilino_id', 'fecha_inicio', 'fecha_fin',
      'monto_total', 'sena_valor', 'monto_sena', 'monto_deposito',
    ];
    const first = order.find((field) => !!errors[field]);
    requestAnimationFrame(() => {
      const target = first ? document.getElementById(first) : null;
      (target || document.getElementById('alquiler-validation-summary'))?.focus();
    });
  };
  const hasValidationErrors = (attemptedAdvance || form.formState.isSubmitted)
    && Object.keys(form.formState.errors).length > 0;

  const goForward = async () => {
    setAttemptedAdvance(true);
    setWizardError(null);
    if (wizardStep === 1) {
      const valid = await form.trigger([
        'unidad_id', 'inquilino_id', 'modalidad', 'fecha_inicio', 'fecha_fin',
        'hora_inicio', 'hora_fin',
      ]);
      if (!valid) {
        handleInvalid(form.formState.errors);
        return;
      }
      if (unitDetailLoading) {
        setWizardError('Estamos consultando las modalidades disponibles para esta unidad.');
        return;
      }
      if (unitDetailError || !unitDetail) {
        setWizardError('No pudimos verificar las tarifas de esta unidad. Seleccionala nuevamente para reintentar.');
        return;
      }
      if (!selectedModeOffered) {
        setWizardError('Esta unidad no ofrece la modalidad elegida. Seleccioná otra unidad o modalidad.');
        return;
      }
      setAttemptedAdvance(false);
      setWizardStep(2);
    } else if (wizardStep === 2) {
      const valid = await form.trigger();
      if (!valid) {
        handleInvalid(form.formState.errors);
        return;
      }
      if (form.getValues('estado_pago') === 'seña_cobrada' && (form.getValues('monto_sena') || 0) <= 0) {
        setWizardError('Para marcar la seña como cobrada, configurá primero una seña válida.');
        return;
      }
      setAttemptedAdvance(false);
      setWizardStep(3);
    }
  };

  const hasInquilinos = inquilinosList.length > 0;
  const hasUnidades = unidadesList.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        onClick={() => handleOpenChange(true)}
        render={
          <Button
            data-testid="btn-nuevo-alquiler"
            className="min-h-[44px] min-w-[44px]"
            onClick={() => handleOpenChange(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> Nuevo Alquiler
          </Button>
        }
      />
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 box-border">
        <DialogHeader className="pr-14 text-left">
          <DialogTitle className="text-base sm:text-lg font-bold">Nuevo Alquiler</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Registrá un nuevo contrato locativo con modalidad explícita e intervalos precisos.
          </DialogDescription>
        </DialogHeader>

        {confirmDiscard && !successMessage && (
          <div
            data-testid="alquiler-unsaved-confirm"
            role="alert"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-3 text-sm"
          >
            <p className="font-semibold text-foreground">Hay cambios sin guardar</p>
            <p className="text-muted-foreground">
              Si cerrás, se perderán los datos ingresados.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                ref={continueEditingRef}
                onClick={() => setConfirmDiscard(false)}
                data-testid="alquiler-seguir-editando"
              >
                Seguir editando
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={resetAndClose}
                data-testid="alquiler-descartar-cambios"
              >
                Descartar cambios
              </Button>
            </div>
          </div>
        )}

        {apiErrorMessage && (
          <div
            data-testid="alquiler-api-error"
            role="alert"
            className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs my-2"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{apiErrorMessage}</span>
          </div>
        )}

        {successMessage ? (
          <div
            data-testid="alquiler-success-feedback"
            className="w-full box-border p-4 sm:p-6 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-center space-y-4 my-4 overflow-hidden"
          >
            <ShieldCheck className="w-8 h-8 mx-auto text-emerald-600 dark:text-emerald-400" />
            <div className="font-bold text-base">{successMessage}</div>
            <p className="text-xs text-muted-foreground">
              La operación autorizada se ejecutó correctamente dentro de tu alcance.
            </p>
            <div className="pt-2 flex justify-center">
              <Button
                type="button"
                data-testid="btn-cerrar-alquiler-exito"
                onClick={() => handleOpenChange(false)}
                className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-6 text-sm font-medium"
              >
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <form noValidate onSubmit={form.handleSubmit(onSubmit, handleInvalid)} className="space-y-4 pt-1">
            {hasValidationErrors && (
              <div id="alquiler-validation-summary" data-testid="alquiler-validation-summary"
                role="alert" tabIndex={-1}
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive focus:outline-none">
                Revisá los campos señalados antes de guardar. No se registró ningún alquiler.
              </div>
            )}
            <nav aria-label="Pasos del registro" data-testid="alquiler-wizard-progress"
              className="grid grid-cols-3 gap-2">
              {([[1, 'Datos y fechas'], [2, 'Precio y cobros'], [3, 'Confirmación']] as const)
                .map(([number, label]) => (
                <div key={number} aria-current={wizardStep === number ? 'step' : undefined}
                  className={'rounded-lg border px-2 py-3 text-center text-xs font-semibold ' +
                    (wizardStep === number ? 'border-primary bg-primary/10 text-primary' :
                      wizardStep > number ? 'border-emerald-500/30 bg-emerald-500/5' :
                        'border-border bg-muted/20 text-muted-foreground')}>
                  <span className="block font-mono text-[10px] opacity-70">PASO {number}</span>
                  {label}
                </div>
              ))}
            </nav>
            {wizardError && <p role="alert" data-testid="alquiler-wizard-error"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{wizardError}</p>}

            <div className={wizardStep === 1 ? 'space-y-4' : 'hidden'} data-testid="alquiler-wizard-datos">
            {/* Selector Canónico de Modalidad */}
            <div className="grid gap-1.5 p-3 rounded-xl bg-muted/20 border border-border/80">
              <div className="flex items-center justify-between">
                <Label htmlFor="modalidad" className="text-xs font-semibold flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  <span>Modalidad de Alquiler *</span>
                </Label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase font-bold">
                    {watchedModalidad}
                  </span>
                </div>
              </div>

              <select
                id="modalidad"
                name="modalidad"
                data-testid="modality-select"
                value={watchedModalidad}
                onChange={(e) => handleModalityChange(e.target.value as RentalModality)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="mensual">Mensual (Contrato a largo plazo)</option>
                <option value="diaria">Diaria (Por día / noche)</option>
                <option value="por_hora">Por Hora (Turnos)</option>
              </select>

              {/* Botones de acceso rápido para auditorías de accesibilidad */}
              <div className="flex items-center gap-1.5 pt-1">
                <Button
                  type="button"
                  variant={watchedModalidad === 'mensual' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleModalityChange('mensual')}
                  aria-pressed={watchedModalidad === 'mensual'}
                  className="min-h-11 px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Calendar className="h-3 w-3 mr-1" /> Mensual
                </Button>
                <Button
                  type="button"
                  variant={watchedModalidad === 'diaria' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleModalityChange('diaria')}
                  aria-pressed={watchedModalidad === 'diaria'}
                  className="min-h-11 px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Calendar className="h-3 w-3 mr-1" /> Diaria
                </Button>
                <Button
                  type="button"
                  variant={watchedModalidad === 'por_hora' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleModalityChange('por_hora')}
                  aria-pressed={watchedModalidad === 'por_hora'}
                  className="min-h-11 px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Clock className="h-3 w-3 mr-1" /> Por Hora
                </Button>
              </div>
            </div>

            {/* Selección de Unidad */}
            <div className="grid gap-1.5">
              <Label htmlFor="unidad_id">Unidad *</Label>
              <select
                id="unidad_id"
                name="unidad_id"
                aria-invalid={!!form.formState.errors.unidad_id}
                aria-describedby={form.formState.errors.unidad_id ? 'alquiler-unidad-error' : undefined}
                value={form.watch('unidad_id')}
                onChange={(e) => form.setValue('unidad_id', e.target.value, { shouldDirty: true, shouldValidate: true })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 truncate"
                disabled={!hasUnidades}
              >
                <option value="">{hasUnidades ? 'Seleccione una unidad' : 'Cargá una unidad primero'}</option>
                {unidadesList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.titulo_es || `Unidad ${u.categoria}`}
                  </option>
                ))}
              </select>
              {form.formState.errors.unidad_id && (
                <span id="alquiler-unidad-error" className="text-xs text-destructive">{form.formState.errors.unidad_id.message}</span>
              )}
            </div>

            {/* Selección de Inquilino + Creación Rápida in situ */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="inquilino_id">Inquilino *</Label>
              </div>
              <div className="flex items-center gap-2">
                <select
                  id="inquilino_id"
                  name="inquilino_id"
                  aria-invalid={!!form.formState.errors.inquilino_id}
                  aria-describedby={form.formState.errors.inquilino_id ? 'alquiler-inquilino-error' : undefined}
                  value={form.watch('inquilino_id')}
                  onChange={(e) => form.setValue('inquilino_id', e.target.value, { shouldDirty: true, shouldValidate: true })}
                  className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 truncate"
                  disabled={!hasInquilinos}
                >
                  <option value="">{hasInquilinos ? 'Seleccione un inquilino' : 'Cargá un inquilino primero'}</option>
                  {inquilinosList.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nombre_completo}
                    </option>
                  ))}
                </select>

                <InquilinoFormModal
                  token={token}
                  trigger={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] px-2.5 text-xs shrink-0 whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Inquilino
                    </Button>
                  }
                  onCreated={(newInq) => {
                    mergeInquilinos([newInq]);
                    form.setValue('inquilino_id', newInq.id, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
                    form.clearErrors('inquilino_id');
                    setTenantCreationFeedback(`${newInq.nombre_completo} registrado y seleccionado. Podés continuar con el alquiler.`);
                  }}
                />
              </div>
              {tenantCreationFeedback && (
                <p data-testid="alquiler-inquilino-creado" role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-foreground">{tenantCreationFeedback}</p>
              )}
              {form.formState.errors.inquilino_id && (
                <span id="alquiler-inquilino-error" className="text-xs text-destructive">{form.formState.errors.inquilino_id.message}</span>
              )}
            </div>

            {/* Selector de fechas con distribución y tactilidad coherentes con Impeccable */}
            <div className="space-y-4 rounded-2xl border border-border bg-muted/10 p-4 sm:p-5" data-testid="alquiler-date-range">
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
                  Fechas del alquiler
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  El inicio debe ser hoy o una fecha futura. {watchedModalidad !== 'por_hora' ? 'La finalización debe ser posterior al inicio.' : 'Para turnos por hora, elegí el día y luego el horario.'}
                </p>
              </div>
              <div className={watchedModalidad === 'por_hora' ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="fecha_inicio" data-testid="daily-checkin" className="text-sm font-medium">
                    {watchedModalidad === 'diaria'
                      ? 'Check-in (Ingreso) *'
                      : watchedModalidad === 'por_hora'
                      ? 'Fecha del Turno *'
                      : 'Fecha Inicio / Check-in *'}
                  </Label>
                  <Controller
                    control={form.control}
                    name="fecha_inicio"
                    render={({ field }) => (
                      <DatePicker
                        id="fecha_inicio"
                        label="Elegir fecha de inicio"
                        date={field.value}
                        setDate={(next) => {
                          if (!next) return;
                          field.onChange(next);
                          const minEnd = watchedModalidad === 'por_hora' ? next : addDays(next, 1);
                          if (watchedModalidad === 'por_hora' || isBefore(startOfDay(form.getValues('fecha_fin')), startOfDay(minEnd))) {
                            form.setValue('fecha_fin', minEnd, { shouldDirty: true, shouldValidate: true });
                          }
                        }}
                        minDate={minimumStartDate}
                        invalid={!!form.formState.errors.fecha_inicio}
                        describedBy={form.formState.errors.fecha_inicio ? 'alquiler-fecha-inicio-error' : undefined}
                        dateFormat="dd/MM/yyyy"
                      />
                    )}
                  />
                  {form.formState.errors.fecha_inicio && (
                    <span id="alquiler-fecha-inicio-error" role="alert" className="text-xs text-destructive">{form.formState.errors.fecha_inicio.message}</span>
                  )}
                </div>

                {watchedModalidad !== 'por_hora' && (
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor="fecha_fin" className="text-sm font-medium">
                      {watchedModalidad === 'diaria' ? 'Check-out (Egreso) *' : 'Fecha Fin *'}
                    </Label>
                    <Controller
                      control={form.control}
                      name="fecha_fin"
                      render={({ field }) => (
                        <DatePicker
                          id="fecha_fin"
                          label="Elegir fecha de finalización"
                          date={field.value}
                          setDate={field.onChange}
                          minDate={minimumEndDate}
                          invalid={!!form.formState.errors.fecha_fin}
                          describedBy={form.formState.errors.fecha_fin ? 'alquiler-fecha-fin-error' : undefined}
                          dateFormat="dd/MM/yyyy"
                        />
                      )}
                    />
                    {form.formState.errors.fecha_fin && (
                      <span id="alquiler-fecha-fin-error" role="alert" className="text-xs text-destructive">{form.formState.errors.fecha_fin.message}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Time Pickers for Hourly Modality */}
              <div className={watchedModalidad === 'por_hora' ? 'grid grid-cols-2 gap-3 pt-1 border-t border-border/60' : 'hidden'}>
                <div className="grid gap-1">
                  <Label htmlFor="hora_inicio" className="text-[11px] font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3 text-primary" /> Hora Inicio (ART UTC-3) *
                  </Label>
                  <Input
                    id="hora_inicio"
                    data-testid="time-start"
                    type="time"
                    {...form.register('hora_inicio')}
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="hora_fin" className="text-[11px] font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3 text-primary" /> Hora Fin (ART UTC-3) *
                  </Label>
                  <Input
                    id="hora_fin"
                    data-testid="time-end"
                    type="time"
                    {...form.register('hora_fin')}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            </div>
            <div className={wizardStep === 2 ? 'space-y-4' : 'hidden'} data-testid="alquiler-wizard-precios">
              <section className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-base font-bold">
                      {watchedModalidad === 'por_hora' ? 'Tarifa del turno' :
                        watchedModalidad === 'diaria' ? 'Precio de la estadía' : 'Condiciones del contrato mensual'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {watchedModalidad === 'por_hora'
                        ? 'Duración real del turno, incluso si termina después de medianoche.'
                        : watchedModalidad === 'diaria'
                          ? 'Noches desde la entrada hasta la salida, sin contar el día del check-out.'
                          : 'Períodos contractuales de meses calendario, sin aproximaciones de 30 días.'}
                    </p>
                  </div>
                  <span className="rounded-lg bg-background px-3 py-2 text-sm font-semibold"
                    data-testid="alquiler-cantidad">
                    {quantity.toLocaleString('es-AR', { maximumFractionDigits: 2 })}{' '}
                    {watchedModalidad === 'por_hora' ? 'horas' : watchedModalidad === 'diaria' ? 'noches' : 'meses'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tarifa_base">
                      {watchedModalidad === 'por_hora' ? 'Tarifa por hora ($ ARS)' :
                        watchedModalidad === 'diaria' ? 'Tarifa por noche ($ ARS)' : 'Alquiler mensual ($ ARS)'}
                    </Label>
                    <Input id="tarifa_base" data-testid="alquiler-tarifa-base"
                      type="number" min={0} step="any"
                      {...form.register('tarifa_base', { valueAsNumber: true })}
                      className="min-h-11"/>
                    <p className="text-[11px] text-muted-foreground">
                      {tariffSuggestion === null
                        ? 'Si no hay tarifa unitaria, ingresá un precio o el total acordado.'
                        : 'Sugerida a partir de la tarifa real de la unidad.'}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cargos_extra">Otros cargos ($ ARS)</Label>
                    <Input id="cargos_extra" type="number" min={0} step="any"
                      {...form.register('cargos_extra', { valueAsNumber: true })} className="min-h-11"/>
                    <p className="text-[11px] text-muted-foreground">Limpieza, servicios u otros cargos pactados.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="descuento">Descuento ($ ARS)</Label>
                    <Input id="descuento" type="number" min={0} step="any"
                      {...form.register('descuento', { valueAsNumber: true })} className="min-h-11"/>
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background p-3 text-sm"
                  data-testid="alquiler-precio-calculado">
                  <span className="text-xs text-muted-foreground">Desglose calculado: </span>
                  {quantity.toLocaleString('es-AR', { maximumFractionDigits: 2 })} × {amountCurrency(watchedTarifa)}
                  {' + '}{amountCurrency(watchedExtras)}{' − '}{amountCurrency(watchedDescuento)}
                  {' = '}<strong>{amountCurrency(rentalAmount(quantity, watchedTarifa, watchedExtras, watchedDescuento))}</strong>
                </div>
              </section>
              {watchedModalidad === 'mensual' && (
                <section className="space-y-3 rounded-2xl border border-border p-4 sm:p-5"
                  data-testid="alquiler-mensual-condiciones">
                  <h3 className="text-sm font-bold">Vencimientos y ajustes acordados</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="dia_vencimiento">Día de vencimiento mensual</Label>
                      <Input id="dia_vencimiento" type="number" min={1} max={31}
                        {...form.register('dia_vencimiento', { valueAsNumber: true })} className="min-h-11"/>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ajuste_porcentaje">Ajuste pactado (%)</Label>
                      <Input id="ajuste_porcentaje" type="number" min={0} max={100} step="any"
                        {...form.register('ajuste_porcentaje', { valueAsNumber: true })} className="min-h-11"/>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ajuste_cada_meses">Revisar ajuste cada (meses)</Label>
                      <Input id="ajuste_cada_meses" type="number" min={1} max={60}
                        {...form.register('ajuste_cada_meses', { valueAsNumber: true })} className="min-h-11"/>
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-3 text-xs" data-testid="alquiler-mensual-vencimientos">
                    <span className="font-semibold">Próximos vencimientos proyectados: </span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[0, 1, 2].slice(0, Math.min(3, Math.ceil(quantity))).map((month) => {
                        const base = addMonths(watchedFechaInicio, month);
                        const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
                        const due = new Date(base.getFullYear(), base.getMonth(), Math.min(Number(watchedVencimiento) || 1, last));
                        return <span key={month} className="rounded bg-background px-2 py-1">{format(due, 'dd/MM/yyyy')}</span>;
                      })}
                    </div>
                    <p className="mt-2 text-muted-foreground">
                      Condiciones guardadas como referencia. No generan cobros,
                      vencimientos exigibles ni aumentos automáticos. El total no contempla futuros ajustes.
                    </p>
                  </div>
                </section>
              )}

            {/* Monto Total */}
            <div className="grid gap-1.5">
              <Label htmlFor="monto_total">Monto Total del Contrato ($ ARS) *</Label>
              <Input
                id="monto_total"
                type="number"
                aria-invalid={!!form.formState.errors.monto_total}
                aria-describedby={form.formState.errors.monto_total ? 'alquiler-monto-error' : undefined}
                min={0}
                step="any"
                {...totalRegister}
                onChange={(event) => {
                  setManualAmount(true);
                  totalRegister.onChange(event);
                }}
                placeholder="0.00"
                className="text-xs sm:text-sm font-semibold"
              />
              {form.formState.errors.monto_total && (
                <span id="alquiler-monto-error" className="text-xs text-destructive">{form.formState.errors.monto_total.message}</span>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p data-testid="alquiler-monto-ayuda" className="text-xs text-muted-foreground">
                  {manualAmount
                    ? 'Total editado manualmente; no se sustituirá por el cálculo sugerido.'
                    : 'Total calculado con las tarifas y cargos. Podés editarlo si el importe acordado es distinto.'}
                </p>
                {manualAmount && <Button type="button" variant="outline" size="sm" onClick={() => {
                  setManualAmount(false);
                  form.setValue('monto_total',
                    rentalAmount(quantity, watchedTarifa, watchedExtras, watchedDescuento),
                    { shouldDirty: true, shouldValidate: true });
                }}>Recalcular automáticamente</Button>}
              </div>
            </div>

            {/* Sección de Seña Opcional y Reutilizable */}
            <div className="p-3.5 rounded-xl bg-muted/20 border border-border/80 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 text-amber-500" />
                  <span>Seña / Anticipo de Reserva</span>
                </Label>
              </div>

              {/* Indicador de Origen / Herencia de Grupo (únicamente si existe grupo válido y activo con seña positiva) */}
              {isGrupoDefaultAvailable && selectedGrupo && (
                <div
                  data-testid="sena-inheritance-source"
                  className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      <strong>Heredado de Grupo:</strong> {selectedGrupo.nombre} (Seña sugerida:{' '}
                      {selectedGrupo.sena_default_tipo === 'monto_fijo'
                        ? `$${Number(selectedGrupo.sena_default_valor).toLocaleString('es-AR')}`
                        : `${selectedGrupo.sena_default_valor}%`}
                      )
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      form.setValue('sena_eleccion', 'heredar_grupo');
                      const tipo = selectedGrupo.sena_default_tipo || 'porcentaje';
                      const val = Number(selectedGrupo.sena_default_valor ?? selectedGrupo.sena_porcentaje ?? 0);
                      const calculated = tipo === 'porcentaje'
                        ? Math.round((watchedTotal * val) / 100)
                        : val;
                      form.setValue('monto_sena', calculated);
                    }}
                    className="h-6 text-[10px] px-2 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                  >
                    Aplicar sugerida
                  </Button>
                </div>
              )}

              {/* Selector de Elección de Seña */}
              <div className={`grid ${isGrupoDefaultAvailable ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                <button
                  type="button"
                  data-testid="btn-sena-sin-sena"
                  onClick={() => {
                    form.setValue('sena_eleccion', 'sin_sena');
                    form.setValue('monto_sena', 0);
                    form.setValue('sena_tipo', undefined);
                    form.setValue('sena_valor', undefined);
                  }}
                  className={`p-2 rounded-lg border text-xs font-medium transition-colors ${
                    watchedSenaEleccion === 'sin_sena'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background hover:bg-muted text-muted-foreground'
                  }`}
                >
                  Sin seña
                </button>
                {isGrupoDefaultAvailable && (
                  <button
                    type="button"
                    data-testid="btn-sena-heredar-grupo"
                    onClick={() => {
                      form.setValue('sena_eleccion', 'heredar_grupo');
                      const tipo = selectedGrupo?.sena_default_tipo || 'porcentaje';
                      const val = Number(selectedGrupo?.sena_default_valor ?? selectedGrupo?.sena_porcentaje ?? 0);
                      const calculated = tipo === 'porcentaje'
                        ? Math.round((watchedTotal * val) / 100)
                        : val;
                      form.setValue('monto_sena', calculated);
                    }}
                    className={`p-2 rounded-lg border text-xs font-medium transition-colors ${
                      watchedSenaEleccion === 'heredar_grupo'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    Heredar del grupo
                  </button>
                )}
                <button
                  type="button"
                  data-testid="btn-sena-personalizada"
                  onClick={() => {
                    form.setValue('sena_eleccion', 'personalizada');
                    if (!form.getValues('sena_tipo')) {
                      form.setValue('sena_tipo', 'monto_fijo');
                    }
                    if (!form.getValues('sena_valor')) {
                      // An explicit user choice must never silently fill a fictional deposit.
                      form.setValue('sena_valor', undefined);
                      form.setValue('monto_sena', 0);
                    }
                  }}
                  className={`p-2 rounded-lg border text-xs font-medium transition-colors ${
                    watchedSenaEleccion === 'personalizada'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background hover:bg-muted text-muted-foreground'
                  }`}
                >
                  Personalizada
                </button>
              </div>

              {/* Sub-estado: Sin Seña */}
              {watchedSenaEleccion === 'sin_sena' && (
                <div
                  data-testid="sena-sin-sena-note"
                  className="p-2.5 rounded-lg bg-muted/30 border border-border/50 text-[11px] text-muted-foreground text-center"
                >
                  El contrato se registrará sin anticipo ni reserva previa.
                </div>
              )}

              {/* Sub-estado: Heredar del Grupo */}
              {watchedSenaEleccion === 'heredar_grupo' && isGrupoDefaultAvailable && selectedGrupo && (
                <div
                  data-testid="sena-preview-card"
                  className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs flex items-center justify-between text-amber-800 dark:text-amber-200"
                >
                  <span>
                    Seña heredada de <strong>{selectedGrupo.nombre}</strong> (
                    {selectedGrupo.sena_default_tipo === 'monto_fijo'
                      ? `$${Number(selectedGrupo.sena_default_valor).toLocaleString('es-AR')}`
                      : `${selectedGrupo.sena_default_valor}%`}
                    ):
                  </span>
                  <span data-testid="sena-preview-amount" className="font-bold font-mono">
                    ${(watchedSena || 0).toLocaleString('es-AR')}
                  </span>
                </div>
              )}

              {/* Sub-estado: Seña Personalizada */}
              {watchedSenaEleccion === 'personalizada' && (
                <div className="p-3 rounded-lg border border-border/80 bg-background/50 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      data-testid="sena-tipo-monto-fijo"
                      onClick={() => {
                        form.setValue('sena_tipo', 'monto_fijo');
                        const val = watchedSenaTipo === 'monto_fijo' ? form.getValues('sena_valor') : undefined;
                        form.setValue('sena_valor', val, { shouldValidate: true });
                        form.setValue('monto_sena', Number(val) || 0, { shouldValidate: true });
                      }}
                      className={`p-1.5 rounded-md border text-xs font-medium transition-colors ${
                        watchedSenaTipo === 'monto_fijo'
                          ? 'border-primary bg-primary/10 text-primary font-bold'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      Monto Fijo ($ ARS)
                    </button>
                    <button
                      type="button"
                      data-testid="sena-tipo-porcentaje"
                      onClick={() => {
                        form.setValue('sena_tipo', 'porcentaje');
                        const pct = watchedSenaTipo === 'porcentaje' ? form.getValues('sena_valor') : undefined;
                        form.setValue('sena_valor', pct, { shouldValidate: true });
                        form.setValue('monto_sena', pct === undefined ? 0 : Math.round((watchedTotal * pct) / 100), { shouldValidate: true });
                      }}
                      className={`p-1.5 rounded-md border text-xs font-medium transition-colors ${
                        watchedSenaTipo === 'porcentaje'
                          ? 'border-primary bg-primary/10 text-primary font-bold'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      Porcentaje (%)
                    </button>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="sena_valor" className="text-xs">
                      {watchedSenaTipo === 'porcentaje'
                        ? 'Porcentaje de Seña (1–100%) *'
                        : 'Monto Fijo de Seña ($ ARS) *'}
                    </Label>
                    <Input
                      id="sena_valor"
                      data-testid="sena-valor-input"
                      type="number"
                      min={1}
                      max={watchedSenaTipo === 'porcentaje' ? 100 : undefined}
                      step="any"
                      value={form.watch('sena_valor') ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : Number(e.target.value);
                        form.setValue('sena_valor', val, { shouldValidate: true });
                        if (val !== undefined && !isNaN(val)) {
                          if (watchedSenaTipo === 'porcentaje') {
                            form.setValue('monto_sena', Math.round((watchedTotal * val) / 100), { shouldValidate: true });
                          } else {
                            form.setValue('monto_sena', val, { shouldValidate: true });
                          }
                        } else {
                          form.setValue('monto_sena', 0);
                        }
                      }}
                      placeholder={watchedSenaTipo === 'porcentaje' ? '20' : '50000'}
                      className="text-xs sm:text-sm font-semibold font-mono"
                    />
                    {(form.formState.errors.sena_valor || form.formState.errors.monto_sena) && (
                      <span data-testid="sena-valor-error" className="text-xs text-destructive">
                        {form.formState.errors.sena_valor?.message || form.formState.errors.monto_sena?.message}
                      </span>
                    )}
                  </div>

                  <div
                    data-testid="sena-preview-card"
                    className="p-2.5 rounded-md bg-muted/40 border border-border/60 text-xs flex items-center justify-between"
                  >
                    <span className="text-muted-foreground">Seña efectiva calculada:</span>
                    <span data-testid="sena-preview-amount" className="font-bold font-mono text-foreground">
                      ${(watchedSena || 0).toLocaleString('es-AR')}
                      {watchedSenaTipo === 'porcentaje' && (
                        <span className="text-[11px] font-normal text-muted-foreground ml-1">
                          ({watchedSenaValor || 0}% de ${watchedTotal.toLocaleString('es-AR')})
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}

                <div className="grid gap-1.5">
                  <Label htmlFor="monto_deposito" className="text-xs flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                    <span>Depósito en Garantía ($ ARS)</span>
                  </Label>
                  <Input
                    id="monto_deposito"
                    type="number"
                    min={0}
                    step="any"
                    {...form.register('monto_deposito', { valueAsNumber: true })}
                    placeholder="0.00"
                    className="text-xs sm:text-sm"
                  />
                  {form.formState.errors.monto_deposito && (
                    <span className="text-xs text-destructive">{form.formState.errors.monto_deposito.message}</span>
                  )}
                </div>
              </div>

            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-3 text-xs">
              <input type="checkbox" id="deposito_recibido" className="mt-1 h-4 w-4 accent-primary"
                checked={watchedGarantiaRecibida}
                disabled={!watchedDeposito}
                onChange={(event) => form.setValue('deposito_recibido', event.target.checked, { shouldDirty: true })}/>
              <span>
                <strong className="block text-foreground">El depósito en garantía ya fue recibido</strong>
                <span className="text-muted-foreground">
                  Dejalo sin marcar si solo se pactó la garantía y todavía no ingresó el dinero.
                </span>
              </span>
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="observaciones">Observaciones (opcional)</Label>
              <textarea id="observaciones" rows={3} maxLength={2000}
                placeholder="Servicios incluidos, acuerdos y condiciones particulares."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                {...form.register('observaciones')} />
            </div>

            {/* Selector de Estado del Cobro Inicial */}
            <div className="grid gap-1.5">
              <Label htmlFor="estado_pago" className="text-xs font-semibold flex items-center gap-1.5">
                <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
                <span>Estado del Cobro Inicial *</span>
              </Label>
              <select
                id="estado_pago"
                {...form.register('estado_pago')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs sm:text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="pendiente">Pendiente de Cobro (Cobrado al iniciar: $0)</option>
                <option value="seña_cobrada">
                  Seña / Anticipo Cobrado (Percibido en caja: ${Number(watchedSena || 0).toLocaleString('es-AR')})
                </option>
                <option value="cobrado_total">
                  Cobrado Totalmente (Percibido en caja: ${Number(watchedTotal || 0).toLocaleString('es-AR')})
                </option>
              </select>
            </div>

            {/* Widget de Desglose Financiero en Tiempo Real */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3.5 sm:p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                    <DollarSign className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold font-mono uppercase tracking-wider text-foreground">
                    Desglose Financiero (Criterio de Caja)
                  </span>
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  Vista previa
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                <div className="p-2.5 rounded-xl bg-background border border-border/60">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase block truncate">
                    Total Contratado
                  </span>
                  <div className="text-xs sm:text-sm font-bold font-mono text-foreground mt-0.5 truncate">
                    ${Number(watchedTotal || 0).toLocaleString('es-AR')}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300 uppercase block truncate">
                    Cobrado al Iniciar (Caja)
                  </span>
                  <div className="text-xs sm:text-sm font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-0.5 truncate">
                    ${Number(cobradoInicial || 0).toLocaleString('es-AR')}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <span className="text-[10px] font-mono text-amber-700 dark:text-amber-300 uppercase block truncate">
                    Saldo Pendiente
                  </span>
                  <div className="text-xs sm:text-sm font-bold font-mono text-amber-700 dark:text-amber-400 mt-0.5 truncate">
                    ${Number(saldoPendiente || 0).toLocaleString('es-AR')}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30">
                  <span className="text-[10px] font-mono text-blue-700 dark:text-blue-300 uppercase block truncate">
                    En Custodia (Garantía)
                  </span>
                  <div className="text-xs sm:text-sm font-bold font-mono text-blue-700 dark:text-blue-400 mt-0.5 truncate">
                    ${Number(fondosCustodia || 0).toLocaleString('es-AR')}
                  </div>
                </div>
              </div>
            </div>

            </div>
            <div className={wizardStep === 3 ? 'space-y-4' : 'hidden'} data-testid="alquiler-wizard-confirmacion">
              <section className="space-y-3 rounded-2xl border border-border bg-muted/10 p-4 sm:p-5">
                <h3 className="text-lg font-bold">Revisá antes de confirmar</h3>
                <p className="text-xs text-muted-foreground">
                  El alquiler solo se registrará cuando confirmes los datos de esta pantalla.
                </p>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Modalidad</dt>
                    <dd className="font-semibold">{watchedModalidad === 'por_hora' ? 'Por hora' :
                      watchedModalidad === 'diaria' ? 'Por día' : 'Mensual'}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Unidad</dt>
                    <dd className="font-semibold">{selectedUnidad?.titulo_es || 'Sin unidad'}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Inquilino</dt>
                    <dd className="font-semibold">{inquilinosList.find((i) => i.id === form.watch('inquilino_id'))?.nombre_completo || 'Sin inquilino'}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Período</dt>
                    <dd className="font-semibold">{format(watchedFechaInicio, 'dd/MM/yyyy')}
                      {watchedModalidad === 'por_hora'
                        ? ' · ' + watchedHoraInicio + ' a ' + watchedHoraFin
                        : ' al ' + format(watchedFechaFin, 'dd/MM/yyyy')}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Duración</dt>
                    <dd className="font-semibold">{quantity.toLocaleString('es-AR', { maximumFractionDigits: 2 })}{' '}
                      {watchedModalidad === 'por_hora' ? 'horas' : watchedModalidad === 'diaria' ? 'noches' : 'meses contractuales'}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Total contratado</dt>
                    <dd className="text-xl font-bold">{amountCurrency(watchedTotal)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Cobrado del alquiler</dt>
                    <dd className="font-semibold">{amountCurrency(cobradoInicial)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Saldo del alquiler</dt>
                    <dd className="font-semibold">{amountCurrency(saldoPendiente)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Depósito pactado</dt>
                    <dd className="font-semibold">{amountCurrency(watchedDeposito)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Garantía recibida</dt>
                    <dd className="font-semibold">{amountCurrency(fondosCustodia)}</dd></div>
                </dl>
                {watchedModalidad === 'mensual' && <p className="rounded-lg bg-background p-3 text-xs text-muted-foreground">
                  Vencimiento: día {watchedVencimiento}. Ajuste pactado: {watchedAjuste}% cada {form.watch('ajuste_cada_meses')} meses.
                  No se programan cobros automáticos.
                </p>}
              </section>
            </div>

            <div data-testid="contrato-upload-after-save" className="rounded-xl border border-border/80 bg-muted/10 p-3.5 space-y-1">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <FileText className="h-3.5 w-3.5 text-primary" /> Contrato digital (opcional)
              </span>
              <p className="text-xs text-muted-foreground">
                Guardá primero el alquiler y después adjuntá el PDF desde su fila en Alquileres.
                El archivo se guardará en una carpeta privada asociada a ese contrato.
              </p>
            </div>

            {/* Acciones */}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (wizardStep > 1) {
                    setWizardStep(wizardStep === 3 ? 2 : 1);
                    setWizardError(null);
                    setAttemptedAdvance(false);
                  } else handleOpenChange(false);
                }}
                className="w-full sm:w-auto min-h-[44px]"
              >
                {wizardStep === 1 ? 'Cancelar' : 'Volver'}
              </Button>
              <Button
                type={wizardStep === 3 ? 'submit' : 'button'}
                onClick={wizardStep === 3 ? undefined : goForward}
                data-testid="btn-guardar-alquiler"
                disabled={isSubmitting}
                className="w-full sm:w-auto min-h-[44px]"
              >
                {isSubmitting ? 'Guardando...' : wizardStep === 3 ? 'Confirmar y guardar alquiler' : 'Continuar'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AlquilerFormModal;
