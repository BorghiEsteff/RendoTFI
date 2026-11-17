-- Rendo: obligaciones operativas privadas por unidad (sin impacto sobre facturación, alquileres ni publicación).
-- Aplicar en entorno de QA antes de producción. Nunca poblar pagos automáticamente.
-- API: la identidad se toma exclusivamente de auth.uid(); no se aceptan clientes anon.
CREATE TABLE IF NOT EXISTS public.unidad_obligaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id uuid NOT NULL REFERENCES public.users(id),
  unidad_id uuid NOT NULL REFERENCES public.unidades(id),
  tipo text NOT NULL CHECK (tipo IN ('expensas','inmobiliario','municipal','luz','agua','gas','mantenimiento','otro')),
  nombre varchar(100) NOT NULL CHECK (length(trim(nombre)) > 0),
  frecuencia text NOT NULL CHECK (frecuencia IN ('mensual','bimestral','anual','unica')),
  periodo_inicio date NOT NULL CHECK (extract(day FROM periodo_inicio) = 1 AND extract(year FROM periodo_inicio) BETWEEN 2000 AND 2200),
  dia_vencimiento smallint NOT NULL DEFAULT 10 CHECK (dia_vencimiento BETWEEN 1 AND 28),
  responsable text NOT NULL CHECK (responsable IN ('propietario','inquilino','gestor','otro')),
  monto_estimado numeric(14,2) CHECK (monto_estimado IS NULL OR monto_estimado >= 0),
  moneda text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','UYU','USD')),
  notas varchar(500),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unidad_obligaciones_id_scope_uk UNIQUE (id, unidad_id, gestor_id)
);
CREATE INDEX IF NOT EXISTS idx_unidad_obligaciones_unidad
  ON public.unidad_obligaciones (unidad_id, activo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unidad_obligaciones_gestor
  ON public.unidad_obligaciones (gestor_id, unidad_id);

CREATE TABLE IF NOT EXISTS public.unidad_obligacion_periodos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligacion_id uuid NOT NULL,
  unidad_id uuid NOT NULL,
  gestor_id uuid NOT NULL REFERENCES public.users(id),
  periodo date NOT NULL CHECK (extract(day FROM periodo) = 1 AND extract(year FROM periodo) BETWEEN 2000 AND 2200),
  vencimiento date NOT NULL,
  estado text NOT NULL CHECK (estado IN ('pagado','pendiente')),
  monto_pagado numeric(14,2) CHECK (monto_pagado IS NULL OR monto_pagado >= 0),
  pagado_at timestamptz,
  pagado_por uuid REFERENCES public.users(id),
  notas varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unidad_obligacion_periodos_owner_fk
    FOREIGN KEY (obligacion_id, unidad_id, gestor_id)
    REFERENCES public.unidad_obligaciones(id, unidad_id, gestor_id)
    ON DELETE RESTRICT,
  CONSTRAINT unidad_obligacion_periodos_unico UNIQUE (obligacion_id, periodo),
  CONSTRAINT unidad_obligacion_periodos_estado_coherente CHECK (
    (estado = 'pagado' AND pagado_at IS NOT NULL AND pagado_por IS NOT NULL)
    OR (estado = 'pendiente' AND pagado_at IS NULL AND pagado_por IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_unidad_obligacion_periodos_unidad
  ON public.unidad_obligacion_periodos (unidad_id, periodo DESC);
CREATE INDEX IF NOT EXISTS idx_unidad_obligacion_periodos_estado
  ON public.unidad_obligacion_periodos (gestor_id, estado, vencimiento);

-- Immutable identity/scope/period; recurrence and payee attribution checked on the server.
CREATE OR REPLACE FUNCTION public.guard_unidad_obligacion_periodo()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_base record;
  v_diff int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Se requiere una sesión autenticada';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.obligacion_id IS DISTINCT FROM OLD.obligacion_id OR
    NEW.unidad_id IS DISTINCT FROM OLD.unidad_id OR
    NEW.gestor_id IS DISTINCT FROM OLD.gestor_id OR
    NEW.periodo IS DISTINCT FROM OLD.periodo OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'No se permite cambiar identidad, unidad o período de un pago registrado';
  END IF;
  SELECT frecuencia, periodo_inicio, dia_vencimiento, activo INTO v_base
    FROM public.unidad_obligaciones WHERE id = NEW.obligacion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obligación no encontrada'; END IF;
  IF NOT v_base.activo THEN RAISE EXCEPTION 'La obligación se encuentra archivada'; END IF;
  v_diff := (extract(year FROM NEW.periodo)::int - extract(year FROM v_base.periodo_inicio)::int) * 12
    + (extract(month FROM NEW.periodo)::int - extract(month FROM v_base.periodo_inicio)::int);
  IF v_diff < 0
      OR (v_base.frecuencia = 'bimestral' AND v_diff % 2 <> 0)
      OR (v_base.frecuencia = 'anual' AND v_diff % 12 <> 0)
      OR (v_base.frecuencia = 'unica' AND v_diff <> 0)
  THEN
    RAISE EXCEPTION 'La obligación no corresponde al período';
  END IF;
  NEW.vencimiento := make_date(extract(year FROM NEW.periodo)::int,
    extract(month FROM NEW.periodo)::int, v_base.dia_vencimiento);
  NEW.updated_at := now();
  IF NEW.estado = 'pagado' THEN
    IF TG_OP = 'UPDATE' AND OLD.estado = 'pagado' THEN
      -- Rectificar el monto o las notas nunca reescribe quién pagó originalmente.
      NEW.pagado_por := OLD.pagado_por;
      NEW.pagado_at := OLD.pagado_at;
    ELSE
      NEW.pagado_por := auth.uid();
      NEW.pagado_at := now();
    END IF;
  ELSE
    NEW.pagado_por := NULL;
    NEW.pagado_at := NULL;
    NEW.monto_pagado := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_unidad_obligacion()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.gestor_id IS DISTINCT FROM OLD.gestor_id OR
       NEW.unidad_id IS DISTINCT FROM OLD.unidad_id OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'La identidad y el propietario de una obligación no pueden modificarse';
    END IF;
    -- No permitir que el Data API eluda la protección que aplica el backend:
    -- cambiar la periodicidad o fecha de vencimiento corrompería pagos ya registrados.
    IF (NEW.frecuencia IS DISTINCT FROM OLD.frecuencia
      OR NEW.periodo_inicio IS DISTINCT FROM OLD.periodo_inicio
      OR NEW.dia_vencimiento IS DISTINCT FROM OLD.dia_vencimiento)
      AND EXISTS (
        SELECT 1 FROM public.unidad_obligacion_periodos
        WHERE obligacion_id = OLD.id
      ) THEN
      RAISE EXCEPTION 'No se puede cambiar periodicidad o vencimiento con pagos registrados';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_unidad_obligacion ON public.unidad_obligaciones;
CREATE TRIGGER trg_guard_unidad_obligacion
  BEFORE INSERT OR UPDATE ON public.unidad_obligaciones
  FOR EACH ROW EXECUTE FUNCTION public.guard_unidad_obligacion();
DROP TRIGGER IF EXISTS trg_guard_unidad_obligacion_periodo ON public.unidad_obligacion_periodos;
CREATE TRIGGER trg_guard_unidad_obligacion_periodo
  BEFORE INSERT OR UPDATE ON public.unidad_obligacion_periodos
  FOR EACH ROW EXECUTE FUNCTION public.guard_unidad_obligacion_periodo();

-- Both tables are strictly private to authorized owners / scoped delegates; no anon reads.
ALTER TABLE public.unidad_obligaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidad_obligacion_periodos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unidad_obligaciones_lectura" ON public.unidad_obligaciones
  FOR SELECT TO authenticated
  USING (public.can_read_unidad(unidad_id)
    AND gestor_id = (SELECT gestor_id FROM public.unidades WHERE id = unidad_id));
CREATE POLICY "unidad_obligaciones_crear" ON public.unidad_obligaciones
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_unidad(unidad_id)
    AND gestor_id = (SELECT gestor_id FROM public.unidades WHERE id = unidad_id));
CREATE POLICY "unidad_obligaciones_editar" ON public.unidad_obligaciones
  FOR UPDATE TO authenticated
  USING (public.can_manage_unidad(unidad_id))
  WITH CHECK (public.can_manage_unidad(unidad_id)
    AND gestor_id = (SELECT gestor_id FROM public.unidades WHERE id = unidad_id));

CREATE POLICY "unidad_obligacion_periodos_lectura" ON public.unidad_obligacion_periodos
  FOR SELECT TO authenticated
  USING (public.can_read_unidad(unidad_id)
    AND gestor_id = (SELECT gestor_id FROM public.unidades WHERE id = unidad_id));
CREATE POLICY "unidad_obligacion_periodos_crear" ON public.unidad_obligacion_periodos
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_unidad(unidad_id)
    AND gestor_id = (SELECT gestor_id FROM public.unidades WHERE id = unidad_id));
CREATE POLICY "unidad_obligacion_periodos_editar" ON public.unidad_obligacion_periodos
  FOR UPDATE TO authenticated
  USING (public.can_manage_unidad(unidad_id))
  WITH CHECK (public.can_manage_unidad(unidad_id)
    AND gestor_id = (SELECT gestor_id FROM public.unidades WHERE id = unidad_id));

REVOKE ALL ON public.unidad_obligaciones FROM authenticated, anon, PUBLIC;
REVOKE ALL ON public.unidad_obligacion_periodos FROM authenticated, anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.unidad_obligaciones TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.unidad_obligacion_periodos TO authenticated;
-- Intentionally no DELETE: disable with activo=false, keep historical payments forever.

-- Append-only audit integrated into the Gestor's existing private audit timeline.
CREATE OR REPLACE FUNCTION public.audit_unidad_obligacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_action text;
  v_metadata jsonb;
  v_unit uuid;
  v_owner uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sin actor autenticado para auditoría'; END IF;
  SELECT CASE WHEN rol = 'delegado' THEN 'delegado'
              WHEN rol = 'admin' THEN 'admin' ELSE 'gestor' END INTO v_role
    FROM public.users WHERE id = v_actor;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Actor sin perfil de auditoría'; END IF;

  v_unit := NEW.unidad_id;
  v_owner := NEW.gestor_id;
  IF TG_TABLE_NAME = 'unidad_obligaciones' THEN
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'crear_obligacion'
      WHEN OLD.activo AND NOT NEW.activo THEN 'archivar_obligacion'
      ELSE 'actualizar_obligacion' END;
    v_metadata := jsonb_build_object('obligacion_id', NEW.id,
      'nombre', NEW.nombre, 'tipo', NEW.tipo, 'frecuencia', NEW.frecuencia, 'moneda', NEW.moneda);
  ELSE
    v_action := CASE WHEN NEW.estado = 'pagado' THEN 'pagar_obligacion' ELSE 'reabrir_obligacion' END;
    v_metadata := jsonb_build_object('obligacion_id', NEW.obligacion_id,
      'periodo', to_char(NEW.periodo, 'YYYY-MM'), 'estado', NEW.estado,
      'monto_pagado', NEW.monto_pagado);
    SELECT v_metadata || jsonb_build_object('nombre', nombre, 'moneda', moneda) INTO v_metadata
      FROM public.unidad_obligaciones WHERE id = NEW.obligacion_id;
  END IF;
  INSERT INTO public.log_acciones (
    gestor_id, actor_id, actor_rol, accion, recurso_tipo, recurso_id, metadata, created_at
  ) VALUES (
    v_owner, v_actor, v_role, v_action, 'unidades', v_unit, v_metadata, now()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_unidad_obligacion ON public.unidad_obligaciones;
CREATE TRIGGER trg_audit_unidad_obligacion
  AFTER INSERT OR UPDATE ON public.unidad_obligaciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_unidad_obligacion();
DROP TRIGGER IF EXISTS trg_audit_unidad_obligacion_periodo ON public.unidad_obligacion_periodos;
CREATE TRIGGER trg_audit_unidad_obligacion_periodo
  AFTER INSERT OR UPDATE ON public.unidad_obligacion_periodos
  FOR EACH ROW EXECUTE FUNCTION public.audit_unidad_obligacion();

-- Las funciones de trigger no son RPC. Evitar ejecución directa vía Data API
-- (y minimizar superficie de SECURITY DEFINER).
REVOKE ALL ON FUNCTION public.guard_unidad_obligacion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_unidad_obligacion_periodo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_unidad_obligacion() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.unidad_obligaciones IS
  'Private per-unit recurring expense obligations; no public marketplace financial exposure.';
COMMENT ON TABLE public.unidad_obligacion_periodos IS
  'Payment history by billing period; no automatic paid status and no destructive deletion.';
