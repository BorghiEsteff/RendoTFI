-- Tenant directory belongs to the gestor's workspace, not to the user who
-- typed the tenant record. Active delegates can consult this directory.
-- Only delegates with Gestionar can edit it. Unidad/Alquiler permissions
-- remain independently scoped and are NOT broadened by these helpers.
CREATE OR REPLACE FUNCTION public.can_read_inquilino(p_inquilino_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inq record;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT i.id, i.gestor_id, i.deleted_at INTO v_inq
  FROM public.inquilinos AS i WHERE i.id = p_inquilino_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Owner can still read an archived tenant for rental-contract history.
  IF v_inq.gestor_id = v_uid THEN RETURN true; END IF;

  -- A delegate may see archived identity only via an existing rental in their
  -- unit scope, so the rental history keeps displaying the tenant's name.
  IF v_inq.deleted_at IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.alquileres a
      WHERE a.inquilino_id = p_inquilino_id
        AND a.deleted_at IS NULL
        AND public.can_read_unidad(a.unidad_id)
    );
  END IF;

  -- Active directory is shared by the owner and *all active delegates of
  -- this gestor*; records are not partitioned by creator or by unit.
  RETURN EXISTS (
    SELECT 1 FROM public.delegaciones d
    WHERE d.delegado_id = v_uid
      AND d.gestor_id = v_inq.gestor_id
      AND d.estado = 'activa'
      AND d.permiso IN ('ver', 'gestionar')
  );
END
$$;

CREATE OR REPLACE FUNCTION public.can_manage_inquilino(p_inquilino_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inq record;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT i.gestor_id, i.deleted_at INTO v_inq
  FROM public.inquilinos i WHERE i.id = p_inquilino_id;
  IF NOT FOUND OR v_inq.deleted_at IS NOT NULL THEN RETURN false; END IF;
  IF v_inq.gestor_id = v_uid THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.delegaciones d
    WHERE d.delegado_id = v_uid
      AND d.gestor_id = v_inq.gestor_id
      AND d.estado = 'activa'
      AND d.permiso = 'gestionar'
  );
END
$$;

-- Lock tenant identity and workspace. A managing delegate cannot delete via
-- a direct PostgREST UPDATE, bypassing the owner-only API delete endpoint.
CREATE OR REPLACE FUNCTION public.protect_inquilino_creator()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.creado_por := auth.uid();
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.gestor_id IS DISTINCT FROM OLD.gestor_id
     OR NEW.creado_por IS DISTINCT FROM OLD.creado_por THEN
    RAISE EXCEPTION 'No se puede modificar la identidad, autoría o gestor del inquilino'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    AND current_user NOT IN ('postgres', 'service_role')
    AND auth.uid() IS DISTINCT FROM OLD.gestor_id THEN
    RAISE EXCEPTION 'La eliminación de inquilinos está reservada al gestor propietario'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

-- An UPDATE needs a USING predicate on the previous row and a WITH CHECK on
-- the next row. With-check is on workspace membership, not active status,
-- because the owner must be allowed to set deleted_at via soft-delete.
DROP POLICY IF EXISTS "Inquilinos update policy" ON public.inquilinos;
CREATE POLICY "Inquilinos update policy"
ON public.inquilinos FOR UPDATE TO authenticated
USING (public.can_manage_inquilino(id))
WITH CHECK (
  gestor_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.delegaciones d
    WHERE d.delegado_id = (SELECT auth.uid())
      AND d.gestor_id = inquilinos.gestor_id
      AND d.estado = 'activa'
      AND d.permiso = 'gestionar'
  )
);

REVOKE ALL ON FUNCTION public.can_read_inquilino(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_inquilino(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_inquilino(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_inquilino(uuid) TO authenticated, service_role;
