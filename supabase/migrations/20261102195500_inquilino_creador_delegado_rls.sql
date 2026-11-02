-- A delegate who can manage rentals must be able to select the orphan
-- tenant they just created. Without this, the tenant is INSERTed successfully
-- but hidden by can_read_inquilino until a rental exists (a catch-22).
-- Preserve read isolation by creator, original owner workspace and active
-- Gestionar delegation; do not expose unrelated orphan tenants.
ALTER TABLE public.inquilinos
  ADD COLUMN IF NOT EXISTS creado_por uuid;

-- Restore documented creator for previously registered tenants. Audit logs
-- identify the authenticated actor and exact tenant UUID. Never guess a creator.
WITH recorded AS (
  SELECT DISTINCT ON (l.recurso_id, l.gestor_id)
    l.recurso_id, l.gestor_id, l.actor_id
  FROM public.log_acciones l
  WHERE l.recurso_tipo = 'inquilinos'
    AND l.accion = 'crear_inquilinos'
    AND l.actor_id IS NOT NULL
  ORDER BY l.recurso_id, l.gestor_id, l.created_at ASC
)
UPDATE public.inquilinos i
SET creado_por = recorded.actor_id
FROM recorded
WHERE i.id = recorded.recurso_id
  AND i.gestor_id = recorded.gestor_id
  AND i.creado_por IS NULL;

CREATE OR REPLACE FUNCTION public.protect_inquilino_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Server-derived identity, never client-supplied.
    NEW.creado_por := auth.uid();
    RETURN NEW;
  END IF;
  IF NEW.creado_por IS DISTINCT FROM OLD.creado_por THEN
    RAISE EXCEPTION 'No se puede modificar la autoría del inquilino'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS protect_inquilino_creator ON public.inquilinos;
CREATE TRIGGER protect_inquilino_creator
BEFORE INSERT OR UPDATE ON public.inquilinos
FOR EACH ROW EXECUTE FUNCTION public.protect_inquilino_creator();

CREATE OR REPLACE FUNCTION public.can_read_inquilino(p_inquilino_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inq record;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  SELECT id, gestor_id, deleted_at, creado_por INTO v_inq
  FROM public.inquilinos WHERE id = p_inquilino_id;
  IF NOT FOUND OR v_inq.deleted_at IS NOT NULL THEN RETURN FALSE; END IF;

  IF v_inq.gestor_id = v_uid THEN RETURN TRUE; END IF;

  -- Only the creator can read an unlinked tenant, and only while their
  -- delegation has active Gestionar permission for this exact workspace.
  IF v_inq.creado_por = v_uid
    AND NOT EXISTS (
      SELECT 1 FROM public.alquileres a
      WHERE a.inquilino_id = p_inquilino_id AND a.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.delegaciones d
      WHERE d.delegado_id = v_uid
        AND d.gestor_id = v_inq.gestor_id
        AND d.estado = 'activa'
        AND d.permiso = 'gestionar'
    ) THEN RETURN TRUE;
  END IF;

  -- After association, the delegated unit/group scope controls access.
  RETURN EXISTS (
    SELECT 1 FROM public.alquileres a
    WHERE a.inquilino_id = p_inquilino_id
      AND a.deleted_at IS NULL
      AND public.can_read_unidad(a.unidad_id)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.can_manage_inquilino(p_inquilino_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inq record;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  SELECT id, gestor_id, deleted_at, creado_por INTO v_inq
  FROM public.inquilinos WHERE id = p_inquilino_id;
  IF NOT FOUND OR v_inq.deleted_at IS NOT NULL THEN RETURN FALSE; END IF;

  IF v_inq.gestor_id = v_uid THEN RETURN TRUE; END IF;

  IF v_inq.creado_por = v_uid
    AND NOT EXISTS (
      SELECT 1 FROM public.alquileres a
      WHERE a.inquilino_id = p_inquilino_id AND a.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.delegaciones d
      WHERE d.delegado_id = v_uid
        AND d.gestor_id = v_inq.gestor_id
        AND d.estado = 'activa'
        AND d.permiso = 'gestionar'
    ) THEN RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.alquileres a
    WHERE a.inquilino_id = p_inquilino_id
      AND a.deleted_at IS NULL
      AND public.can_manage_unidad(a.unidad_id)
  );
END
$$;
