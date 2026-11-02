-- REN-DISP-01: proyección de ocupación, mínima y segura.
-- No cambia la política histórica: TODO alquiler no cancelado ocupa el intervalo.
-- El futuro módulo manual y las reglas horarias siguen pendientes (Spec Kit 003).
CREATE OR REPLACE FUNCTION public.disponibilidad_proyeccion(
  p_unidad uuid, p_desde timestamptz, p_hasta timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_unit record;
  v_rows jsonb;
  v_count integer;
  v_allowed boolean;
BEGIN
  IF p_unidad IS NULL OR p_desde IS NULL OR p_hasta IS NULL
    OR p_hasta <= p_desde OR p_hasta - p_desde > interval '730 days'
  THEN
    RAISE EXCEPTION 'Intervalo inválido (máximo 730 días)' USING ERRCODE='22023';
  END IF;
  SELECT u.id, u.estado::text AS estado INTO v_unit
    FROM public.unidades u
    WHERE u.id=p_unidad AND u.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Published units are public. Non-published units are visible only to
  -- their own gestor or an active delegate with unit scope. Do not return
  -- the owner ID, rental UUID, inquilino, pricing or contact metadata.
  v_allowed := v_unit.estado='publicada' OR
    (auth.uid() IS NOT NULL AND public.can_read_unidad(p_unidad));
  IF NOT v_allowed THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT 1 FROM public.alquileres a
    WHERE a.unidad_id=p_unidad
      AND a.deleted_at IS NULL
      AND a.estado::text<>'cancelado'
      AND a.inicio_at<p_hasta AND a.fin_at>p_desde
    LIMIT 1001
  ) v;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'inicio_at', o.inicio_at, 'fin_at', o.fin_at
    ) ORDER BY o.inicio_at), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT a.inicio_at,a.fin_at FROM public.alquileres a
    WHERE a.unidad_id=p_unidad
      AND a.deleted_at IS NULL
      AND a.estado::text<>'cancelado'
      AND a.inicio_at<p_hasta AND a.fin_at>p_desde
    ORDER BY a.inicio_at LIMIT 1000
  ) o;
  RETURN jsonb_build_object(
    'unidad_id', p_unidad,
    'desde', p_desde,
    'hasta', p_hasta,
    'estado_publicacion', v_unit.estado,
    'precision', 'intervalos_reales',
    'reglas_operativas', 'no_configuradas',
    'ocupaciones', v_rows,
    'truncado', v_count>1000,
    'mensaje', 'Ocupaciones registradas. La ausencia de bloqueos no confirma disponibilidad: faltan reglas de operación y cierres manuales.'
  );
END $$;
REVOKE ALL ON FUNCTION public.disponibilidad_proyeccion(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.disponibilidad_proyeccion(uuid,timestamptz,timestamptz)
 TO anon,authenticated,service_role;
