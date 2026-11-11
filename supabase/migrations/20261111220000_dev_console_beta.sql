-- Rendo beta operations console. Database permissions are deliberately server-only.
-- This migration must be applied to the verified BETA database before enabling the console.
CREATE TABLE IF NOT EXISTS public.rendo_dev_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('dev', 'admin')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rendo_dev_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rendo_dev_access FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rendo_dev_access TO service_role;

-- The invoker is service_role on a vetted server only. Do not grant this RPC to clients.
CREATE OR REPLACE FUNCTION public.rendo_dev_review_moderation(
  p_unit_id uuid, p_action text, p_actor_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_unit public.unidades%ROWTYPE;
  v_new_status public.unidad_estado;
BEGIN
  IF p_action NOT IN ('suspender','restaurar') THEN
    RAISE EXCEPTION 'Acción inválida';
  END IF;
  v_new_status := CASE WHEN p_action='suspender' THEN 'suspendida' ELSE 'publicada' END::public.unidad_estado;
  UPDATE public.unidades SET estado = v_new_status
    WHERE id = p_unit_id AND estado = 'en_revision' AND deleted_at IS NULL
    RETURNING * INTO v_unit;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La unidad ya no está pendiente de revisión';
  END IF;
  INSERT INTO public.log_acciones (gestor_id, actor_id, actor_rol, accion, recurso_tipo, recurso_id, metadata)
    VALUES (v_unit.gestor_id, p_actor_id, 'admin', 'dev_moderacion_' || p_action,
            'unidades', p_unit_id, jsonb_build_object('estado_nuevo',v_new_status));
  RETURN v_new_status::text;
END $$;

CREATE OR REPLACE FUNCTION public.rendo_dev_review_manual_payment(
  p_payment_id uuid, p_decision text, p_actor_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_payment public.pagos%ROWTYPE;
  v_new_status public.estado_pago;
BEGIN
  IF p_decision NOT IN ('aprobar','rechazar') THEN
    RAISE EXCEPTION 'Decisión inválida';
  END IF;
  v_new_status := CASE WHEN p_decision='aprobar' THEN 'aprobado' ELSE 'rechazado' END::public.estado_pago;
  UPDATE public.pagos SET estado = v_new_status, updated_at = now()
    WHERE id = p_payment_id AND metodo = 'efectivo' AND estado = 'pendiente'
    RETURNING * INTO v_payment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no está pendiente o no es manual';
  END IF;
  IF p_decision = 'aprobar' THEN
    UPDATE public.users
      SET cupo_maximo = cupo_maximo + v_payment.cupo_adquirido,
          suscripcion_expira_en = greatest(coalesce(suscripcion_expira_en, now()), now()) + interval '30 days'
      WHERE id = v_payment.gestor_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gestor inactivo o inexistente';
    END IF;
  END IF;
  INSERT INTO public.log_acciones (gestor_id, actor_id, actor_rol, accion, recurso_tipo, recurso_id, metadata)
    VALUES (v_payment.gestor_id, p_actor_id, 'admin', 'dev_pago_' || p_decision,
            'pagos', p_payment_id, jsonb_build_object('metodo',v_payment.metodo,
              'monto',v_payment.monto,'cupo_adquirido',v_payment.cupo_adquirido));
  RETURN v_new_status::text;
END $$;

REVOKE ALL ON FUNCTION public.rendo_dev_review_moderation(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rendo_dev_review_manual_payment(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rendo_dev_review_moderation(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rendo_dev_review_manual_payment(uuid,text,uuid) TO service_role;
