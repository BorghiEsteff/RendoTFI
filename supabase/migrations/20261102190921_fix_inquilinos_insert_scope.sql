-- Fix the correlated RLS check for tenant creation.
-- In the previous policy, d.gestor_id = gestor_id was resolved by PostgreSQL
-- to d.gestor_id = d.gestor_id, letting a delegate target other workspaces.
-- Never expand orphan-tenant SELECT permissions: a delegate may not read a
-- tenant until a rental in the delegate's authorized scope links to it.
DROP POLICY IF EXISTS "Inquilinos insert policy" ON public.inquilinos;

CREATE POLICY "Inquilinos insert policy"
ON public.inquilinos FOR INSERT
TO authenticated
WITH CHECK (
  (
    gestor_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.users AS owner_profile
      WHERE owner_profile.id = (SELECT auth.uid())
        AND owner_profile.rol = 'gestor'
        AND owner_profile.deleted_at IS NULL
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.delegaciones AS scoped_delegation
    WHERE scoped_delegation.delegado_id = (SELECT auth.uid())
      AND scoped_delegation.gestor_id = inquilinos.gestor_id
      AND scoped_delegation.estado = 'activa'
      AND scoped_delegation.permiso = 'gestionar'
  )
);
