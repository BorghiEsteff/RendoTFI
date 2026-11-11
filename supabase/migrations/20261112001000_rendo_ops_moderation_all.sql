-- RENDO OPS: manual moderation independent of the 50-report auto-review threshold.
-- Private origin state lets the superadmin restore pausada/no_disponible correctly.
CREATE TABLE IF NOT EXISTS public.rendo_dev_moderation_origin (
  unidad_id uuid PRIMARY KEY REFERENCES public.unidades(id) ON DELETE CASCADE,
  estado_previo public.unidad_estado NOT NULL
    CHECK (estado_previo IN ('publicada','pausada','no_disponible')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rendo_dev_moderation_origin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rendo_dev_moderation_origin FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rendo_dev_moderation_origin TO service_role;

CREATE OR REPLACE FUNCTION public.rendo_dev_review_moderation(
  p_unit_id uuid, p_action text, p_actor_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_unit public.unidades%ROWTYPE;
  v_prev public.unidad_estado;
  v_new public.unidad_estado;
BEGIN
  -- Defense in depth: only the singleton access row may act.
  -- DevGuard verifies Supabase email; DB trigger enforces its confirmed owner.
  -- service_role intentionally lacks direct SELECT on auth.users.
  IF NOT EXISTS (
    SELECT 1 FROM public.rendo_dev_access a
    WHERE a.user_id = p_actor_id
      AND a.enabled = true
      AND a.role = 'dev'
  ) THEN
    RAISE EXCEPTION 'No autorizado para moderar';
  END IF;
  IF p_action NOT IN ('revisar','suspender','restaurar') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Acción de moderación inválida';
  END IF;
  SELECT * INTO v_unit FROM public.unidades
    WHERE id = p_unit_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publicación inexistente o eliminada';
  END IF;

  IF p_action = 'revisar' THEN
    IF v_unit.estado NOT IN ('publicada','pausada','no_disponible') THEN
      RAISE EXCEPTION 'Solo pueden enviarse a revisión publicaciones públicas o pausadas';
    END IF;
    v_new := 'en_revision'::public.unidad_estado;
  ELSIF p_action = 'suspender' THEN
    IF v_unit.estado NOT IN ('publicada','pausada','no_disponible','en_revision') THEN
      RAISE EXCEPTION 'El estado actual no admite suspensión manual';
    END IF;
    v_new := 'suspendida'::public.unidad_estado;
  ELSE
    IF v_unit.estado NOT IN ('en_revision','suspendida') THEN
      RAISE EXCEPTION 'Solo se puede restaurar una publicación en revisión o suspendida';
    END IF;
    SELECT estado_previo INTO v_prev
      FROM public.rendo_dev_moderation_origin WHERE unidad_id = p_unit_id;
    -- Old automatic reviews have no saved origin; their prior state was publicada.
    v_new := COALESCE(v_prev, 'publicada'::public.unidad_estado);
  END IF;

  IF p_action IN ('revisar','suspender')
    AND v_unit.estado IN ('publicada','pausada','no_disponible') THEN
    INSERT INTO public.rendo_dev_moderation_origin(unidad_id,estado_previo)
      VALUES(p_unit_id,v_unit.estado)
    ON CONFLICT (unidad_id) DO NOTHING;
  END IF;

  UPDATE public.unidades SET estado = v_new WHERE id = p_unit_id;
  IF p_action = 'restaurar' THEN
    DELETE FROM public.rendo_dev_moderation_origin WHERE unidad_id = p_unit_id;
  END IF;
  INSERT INTO public.log_acciones
    (gestor_id,actor_id,actor_rol,accion,recurso_tipo,recurso_id,metadata)
  VALUES (v_unit.gestor_id,p_actor_id,'admin','dev_moderacion_' || p_action,
    'unidades',p_unit_id,
    jsonb_build_object('estado_anterior',v_unit.estado::text,
      'estado_nuevo',v_new::text,'reportes_count',v_unit.reportes_count));
  RETURN v_new::text;
END;
$$;

REVOKE ALL ON FUNCTION public.rendo_dev_review_moderation(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rendo_dev_review_moderation(uuid,text,uuid)
  TO service_role;
