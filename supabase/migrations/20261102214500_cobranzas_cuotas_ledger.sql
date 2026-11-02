-- REN-COB-01: subledger contractual, separado de public.pagos (cupos SaaS).
-- Migración aditiva: NO crea planes sobre alquileres existentes ni modifica cobros.
CREATE TABLE public.cobranza_cuotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  alquiler_id uuid NOT NULL REFERENCES public.alquileres(id) ON DELETE RESTRICT,
  numero integer NOT NULL CHECK (numero BETWEEN 1 AND 120),
  periodo_inicio date NOT NULL,
  vencimiento date NOT NULL,
  monto numeric(14,2) NOT NULL CHECK (monto > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobranza_cuotas_numero_uk UNIQUE(alquiler_id, numero)
);
CREATE INDEX idx_cobranza_cuotas_gestor_vencimiento ON public.cobranza_cuotas(gestor_id, vencimiento);
CREATE INDEX idx_cobranza_cuotas_alquiler ON public.cobranza_cuotas(alquiler_id);

CREATE TABLE public.cobranza_pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  alquiler_id uuid NOT NULL REFERENCES public.alquileres(id) ON DELETE RESTRICT,
  cuota_id uuid NOT NULL REFERENCES public.cobranza_cuotas(id) ON DELETE RESTRICT,
  importe numeric(14,2) NOT NULL CHECK (importe > 0),
  tipo text NOT NULL CHECK (tipo IN ('apertura', 'cobro')),
  medio text CHECK (medio IN ('efectivo','transferencia','mercadopago','otro')),
  fecha_pago date,
  referencia text CHECK (char_length(referencia) <= 160),
  registrado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  anulado_at timestamptz,
  anulado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  motivo_anulacion text,
  CONSTRAINT cobranza_pagos_apertura_uk UNIQUE(cuota_id, tipo),
  CONSTRAINT cobranza_pagos_combinacion_check CHECK (
    (tipo='apertura' AND medio IS NULL AND fecha_pago IS NULL)
    OR (tipo='cobro' AND medio IS NOT NULL AND fecha_pago IS NOT NULL)
  ),
  CONSTRAINT cobranza_pagos_anulacion_check CHECK (
    (anulado_at IS NULL AND anulado_por IS NULL AND motivo_anulacion IS NULL)
    OR (anulado_at IS NOT NULL AND anulado_por IS NOT NULL AND char_length(trim(motivo_anulacion)) >= 8)
  )
);
-- Multiple ordinary payments are valid. The partial unique index reserves
-- exactly one inherited opening allocation per installment.
ALTER TABLE public.cobranza_pagos DROP CONSTRAINT cobranza_pagos_apertura_uk;
CREATE UNIQUE INDEX idx_cobranza_apertura_unica ON public.cobranza_pagos(cuota_id) WHERE tipo='apertura';
CREATE INDEX idx_cobranza_pagos_alquiler ON public.cobranza_pagos(alquiler_id);
CREATE INDEX idx_cobranza_pagos_cuota ON public.cobranza_pagos(cuota_id);

ALTER TABLE public.cobranza_cuotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobranza_pagos ENABLE ROW LEVEL SECURITY;
CREATE POLICY cobranza_cuotas_leer ON public.cobranza_cuotas
 FOR SELECT TO authenticated
 USING (EXISTS (
   SELECT 1 FROM public.alquileres a
   WHERE a.id=alquiler_id AND a.gestor_id=cobranza_cuotas.gestor_id
   AND a.deleted_at IS NULL AND public.can_read_unidad(a.unidad_id)
 ));
CREATE POLICY cobranza_pagos_leer ON public.cobranza_pagos
 FOR SELECT TO authenticated
 USING (EXISTS (
   SELECT 1 FROM public.alquileres a
   WHERE a.id=alquiler_id AND a.gestor_id=cobranza_pagos.gestor_id
   AND a.deleted_at IS NULL AND public.can_read_unidad(a.unidad_id)
 ));
REVOKE ALL ON public.cobranza_cuotas,public.cobranza_pagos FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cobranza_cuotas,public.cobranza_pagos TO authenticated;
GRANT ALL ON public.cobranza_cuotas,public.cobranza_pagos TO service_role;

CREATE OR REPLACE FUNCTION public.cobranzas_generar_plan(p_alquiler uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  a record;
  v_total integer := 0;
  v_idx integer;
  v_inicio date;
  v_fin date;
  v_periodo date;
  v_day integer;
  v_vencimiento date;
  v_last_day integer;
  v_cents bigint;
  v_share bigint;
  v_amount numeric(14,2);
  v_pending numeric(14,2);
  v_apertura numeric(14,2);
  v_cuota uuid;
  v_existing integer;
  v_existing_total numeric(14,2);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Autenticación requerida' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.alquileres
    WHERE id=p_alquiler AND deleted_at IS NULL AND estado::text <> 'cancelado'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alquiler no encontrado o cancelado' USING ERRCODE='P0002'; END IF;
  IF NOT public.can_manage_unidad(a.unidad_id) THEN
    RAISE EXCEPTION 'Sin permiso de gestión sobre el alquiler' USING ERRCODE='42501';
  END IF;
  IF a.monto_total <= 0 OR a.monto_total > 99999999999 OR a.monto_total <> round(a.monto_total,2) THEN
    RAISE EXCEPTION 'Monto contractual inválido' USING ERRCODE='22023';
  END IF;
  IF coalesce(a.monto_cobrado,0) < 0 OR coalesce(a.monto_cobrado,0) > a.monto_total THEN
    RAISE EXCEPTION 'El cobro inicial excede el contrato' USING ERRCODE='22023';
  END IF;

  v_inicio := (a.inicio_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_fin := (a.fin_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  IF a.modalidad='mensual' THEN
    v_total := 0;
    FOR v_idx IN 0..119 LOOP
      v_periodo := (v_inicio + make_interval(months => v_idx))::date;
      EXIT WHEN v_periodo >= v_fin;
      v_total := v_total+1;
    END LOOP;
    IF v_total=120 AND (v_inicio + interval '120 months')::date < v_fin THEN
      RAISE EXCEPTION 'Contrato supera 120 mensualidades' USING ERRCODE='22023';
    END IF;
  ELSE
    v_total := 1;
  END IF;
  IF v_total < 1 THEN RAISE EXCEPTION 'Período del alquiler inválido' USING ERRCODE='22023'; END IF;
  SELECT count(*),coalesce(sum(monto),0) INTO v_existing,v_existing_total
    FROM public.cobranza_cuotas WHERE alquiler_id=p_alquiler;
  IF v_existing > 0 THEN
    IF v_existing<>v_total OR v_existing_total<>a.monto_total THEN
      RAISE EXCEPTION 'Ya existe un plan distinto; no se modifican cuotas emitidas'
        USING ERRCODE='23505';
    END IF;
    RETURN v_existing;
  END IF;

  v_cents := (a.monto_total*100)::bigint;
  v_share := v_cents/v_total;
  v_pending := coalesce(a.monto_cobrado,0)::numeric(14,2);
  v_day := coalesce(nullif((a.detalle_precio->>'dia_vencimiento')::integer,0),
     extract(day from v_inicio)::integer);
  IF v_day<1 OR v_day>31 THEN v_day := extract(day from v_inicio)::integer; END IF;
  FOR v_idx IN 1..v_total LOOP
    v_periodo := CASE WHEN a.modalidad='mensual'
      THEN (v_inicio + make_interval(months => v_idx-1))::date ELSE v_inicio END;
    v_last_day := extract(day from
      ((date_trunc('month',v_periodo)::date + interval '1 month')::date - 1)
    )::integer;
    v_vencimiento := CASE WHEN a.modalidad='mensual'
      THEN greatest(v_periodo, make_date(extract(year from v_periodo)::int,
        extract(month from v_periodo)::int,least(v_day,v_last_day)))
      ELSE v_inicio END;
    v_amount := (CASE WHEN v_idx=v_total
      THEN v_cents-v_share*(v_total-1) ELSE v_share END)::numeric/100;
    IF v_amount<=0 THEN RAISE EXCEPTION 'Cuota con importe no positivo' USING ERRCODE='22023'; END IF;
    INSERT INTO public.cobranza_cuotas(gestor_id,alquiler_id,numero,periodo_inicio,vencimiento,monto)
    VALUES(a.gestor_id,a.id,v_idx,v_periodo,v_vencimiento,v_amount) RETURNING id INTO v_cuota;
    IF v_pending>0 THEN
      v_apertura := least(v_pending,v_amount);
      INSERT INTO public.cobranza_pagos
        (gestor_id,alquiler_id,cuota_id,importe,tipo,registrado_por)
      VALUES(a.gestor_id,a.id,v_cuota,v_apertura,'apertura',v_actor);
      v_pending := v_pending-v_apertura;
    END IF;
  END LOOP;
  RETURN v_total;
END $$;

CREATE OR REPLACE FUNCTION public.cobranzas_registrar_pago(
  p_cuota uuid, p_importe numeric, p_fecha_pago date, p_medio text, p_referencia text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  a record;
  q record;
  v_pagado numeric(14,2);
  v_total numeric(14,2);
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Autenticación requerida' USING ERRCODE='42501'; END IF;
  SELECT c.alquiler_id INTO q FROM public.cobranza_cuotas c WHERE c.id=p_cuota;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuota no encontrada' USING ERRCODE='P0002'; END IF;
  SELECT * INTO a FROM public.alquileres
    WHERE id=q.alquiler_id AND deleted_at IS NULL AND estado::text <> 'cancelado'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alquiler no disponible' USING ERRCODE='P0002'; END IF;
  IF NOT public.can_manage_unidad(a.unidad_id) THEN
    RAISE EXCEPTION 'Sin permiso de gestión' USING ERRCODE='42501'; END IF;
  SELECT * INTO q FROM public.cobranza_cuotas WHERE id=p_cuota
    AND alquiler_id=a.id AND gestor_id=a.gestor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuota no vinculada al alquiler' USING ERRCODE='P0002'; END IF;
  IF p_importe IS NULL OR p_importe<=0 OR p_importe<>round(p_importe,2) OR p_importe>99999999999 THEN
    RAISE EXCEPTION 'Importe inválido; usar hasta dos decimales' USING ERRCODE='22023'; END IF;
  IF p_fecha_pago IS NULL OR p_fecha_pago > (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN
    RAISE EXCEPTION 'Fecha de pago inválida o futura' USING ERRCODE='22023'; END IF;
  IF p_medio IS NULL OR p_medio NOT IN ('efectivo','transferencia','mercadopago','otro') THEN
    RAISE EXCEPTION 'Medio de pago no admitido' USING ERRCODE='22023'; END IF;
  IF p_referencia IS NOT NULL AND char_length(p_referencia)>160 THEN
    RAISE EXCEPTION 'Referencia demasiado larga' USING ERRCODE='22023'; END IF;
  SELECT coalesce(sum(importe),0) INTO v_pagado FROM public.cobranza_pagos
    WHERE cuota_id=p_cuota AND anulado_at IS NULL;
  IF p_importe>q.monto-v_pagado THEN
    RAISE EXCEPTION 'El importe excede el saldo pendiente' USING ERRCODE='22023'; END IF;
  INSERT INTO public.cobranza_pagos
    (gestor_id,alquiler_id,cuota_id,importe,tipo,medio,fecha_pago,referencia,registrado_por)
  VALUES(a.gestor_id,a.id,q.id,p_importe,'cobro',p_medio,p_fecha_pago,nullif(trim(p_referencia),''),
    v_actor) RETURNING id INTO v_id;
  SELECT coalesce(sum(importe),0) INTO v_total FROM public.cobranza_pagos
    WHERE alquiler_id=a.id AND anulado_at IS NULL;
  UPDATE public.alquileres SET monto_cobrado=v_total,
    estado_pago=CASE WHEN v_total>=a.monto_total THEN 'cobrado_total'
      WHEN coalesce(a.monto_sena,0)>0 AND v_total>=a.monto_sena THEN 'seña_cobrada'
      ELSE 'pendiente' END
    WHERE id=a.id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.cobranzas_anular_pago(p_pago uuid,p_motivo text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  a record;
  v_cuota uuid;
  v_pagado numeric(14,2);
  p record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Autenticación requerida' USING ERRCODE='42501'; END IF;
  SELECT alquiler_id INTO p FROM public.cobranza_pagos WHERE id=p_pago;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago no encontrado' USING ERRCODE='P0002'; END IF;
  SELECT * INTO a FROM public.alquileres WHERE id=p.alquiler_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alquiler no encontrado' USING ERRCODE='P0002'; END IF;
  IF NOT public.can_manage_unidad(a.unidad_id) THEN
    RAISE EXCEPTION 'Sin permiso de gestión' USING ERRCODE='42501'; END IF;
  IF p_motivo IS NULL OR char_length(trim(p_motivo))<8 OR char_length(p_motivo)>500 THEN
    RAISE EXCEPTION 'Indicar motivo de anulación de 8 a 500 caracteres' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.cobranza_pagos WHERE id=p_pago AND alquiler_id=a.id;
  IF p.tipo<>'cobro' OR p.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pago de apertura o ya anulado: operación rechazada' USING ERRCODE='22023'; END IF;
  UPDATE public.cobranza_pagos SET anulado_at=now(),anulado_por=v_actor,
    motivo_anulacion=trim(p_motivo) WHERE id=p_pago;
  SELECT coalesce(sum(importe),0) INTO v_pagado FROM public.cobranza_pagos
    WHERE alquiler_id=a.id AND anulado_at IS NULL;
  UPDATE public.alquileres SET monto_cobrado=v_pagado,
    estado_pago=CASE WHEN v_pagado>=a.monto_total THEN 'cobrado_total'
      WHEN coalesce(a.monto_sena,0)>0 AND v_pagado>=a.monto_sena THEN 'seña_cobrada'
      ELSE 'pendiente' END WHERE id=a.id;
  RETURN true;
END $$;

-- A plan is immutable. Prevent direct PostgREST edits to underlying contract
-- finances and interval that would invalidate the posted obligations/receipts.
CREATE OR REPLACE FUNCTION public.protect_alquiler_plan_finances()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.cobranza_cuotas WHERE alquiler_id=OLD.id)
     AND current_user NOT IN ('postgres','service_role')
     AND (
       NEW.monto_total IS DISTINCT FROM OLD.monto_total
       OR NEW.monto_cobrado IS DISTINCT FROM OLD.monto_cobrado
       OR NEW.estado_pago IS DISTINCT FROM OLD.estado_pago
       OR NEW.modalidad IS DISTINCT FROM OLD.modalidad
       OR NEW.inicio_at IS DISTINCT FROM OLD.inicio_at
       OR NEW.fin_at IS DISTINCT FROM OLD.fin_at
       OR NEW.gestor_id IS DISTINCT FROM OLD.gestor_id
       OR NEW.unidad_id IS DISTINCT FROM OLD.unidad_id
       OR NEW.inquilino_id IS DISTINCT FROM OLD.inquilino_id
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     ) THEN
    RAISE EXCEPTION 'El contrato tiene cuotas emitidas; usar el módulo Cobros y deudas'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_alquiler_plan_finances BEFORE UPDATE ON public.alquileres
 FOR EACH ROW EXECUTE FUNCTION public.protect_alquiler_plan_finances();

REVOKE ALL ON FUNCTION public.cobranzas_generar_plan(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cobranzas_registrar_pago(uuid,numeric,date,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cobranzas_anular_pago(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cobranzas_generar_plan(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cobranzas_registrar_pago(uuid,numeric,date,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cobranzas_anular_pago(uuid,text) TO authenticated,service_role;
