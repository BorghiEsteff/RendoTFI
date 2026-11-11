-- Rendo beta has a single superadmin: the verified devtest@gmail.com account.
-- This is a hard guard against accidentally granting an additional dev/admin.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.rendo_dev_access a
    LEFT JOIN auth.users u ON u.id = a.user_id
    WHERE a.enabled
      AND (a.role <> 'dev' OR lower(coalesce(u.email,'')) <> 'devtest@gmail.com')
  ) THEN
    RAISE EXCEPTION 'Existing privileged account conflicts with the single Rendo superadmin';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rendo_dev_invitations
    WHERE email <> 'devtest@gmail.com' OR role <> 'dev'
  ) THEN
    RAISE EXCEPTION 'Unexpected dev invitations exist; review before enabling single superadmin';
  END IF;
END
$do$;

ALTER TABLE public.rendo_dev_access
  ADD CONSTRAINT rendo_only_superadmin_role CHECK (role = 'dev');

ALTER TABLE public.rendo_dev_invitations
  ADD CONSTRAINT rendo_only_superadmin_invitation
  CHECK (email = 'devtest@gmail.com' AND role = 'dev');

-- At most one enabled privileged account, including under concurrent writes.
CREATE UNIQUE INDEX rendo_only_one_active_superadmin
  ON public.rendo_dev_access (role) WHERE enabled = true;

-- Server-side authorization cannot be reassigned to a different or unverified email.
CREATE OR REPLACE FUNCTION public.rendo_validate_single_dev_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.enabled AND NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = NEW.user_id
       AND lower(u.email) = 'devtest@gmail.com'
       AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'RENDO OPS requires the unique verified superadmin account';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rendo_validate_single_dev_owner()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rendo_validate_single_dev_owner_trigger
  ON public.rendo_dev_access;

CREATE TRIGGER rendo_validate_single_dev_owner_trigger
BEFORE INSERT OR UPDATE OF user_id, role, enabled
ON public.rendo_dev_access
FOR EACH ROW EXECUTE FUNCTION public.rendo_validate_single_dev_owner();
