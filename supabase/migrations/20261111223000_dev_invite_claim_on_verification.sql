-- Rendo: one-time invitation to an existing or future confirmed Auth user.
-- Email verification, not a claim supplied by the browser, is the grant boundary.
CREATE TABLE IF NOT EXISTS public.rendo_dev_invitations (
  email text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('dev', 'admin')),
  expires_at timestamptz NOT NULL,
  claimed_by uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rendo_dev_invitation_normalized_email CHECK (email = lower(btrim(email)))
);

ALTER TABLE public.rendo_dev_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rendo_dev_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rendo_dev_invitations TO service_role;

CREATE OR REPLACE FUNCTION public.rendo_dev_claim_verified_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_should_claim boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_claim := true;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.email IS DISTINCT FROM NEW.email OR
       (OLD.email_confirmed_at IS NOT NULL AND NEW.email_confirmed_at IS NULL) THEN
      UPDATE public.rendo_dev_access SET enabled = false, updated_at = now()
        WHERE user_id = NEW.id;
    END IF;
    v_should_claim := OLD.email_confirmed_at IS NULL OR OLD.email IS DISTINCT FROM NEW.email;
  END IF;

  IF NEW.email_confirmed_at IS NOT NULL AND NEW.email IS NOT NULL
     AND v_should_claim THEN
    UPDATE public.rendo_dev_invitations
       SET claimed_by = NEW.id, claimed_at = now()
     WHERE email = lower(btrim(NEW.email))
       AND claimed_at IS NULL
       AND expires_at > now()
     RETURNING role INTO v_role;

    IF FOUND THEN
      INSERT INTO public.rendo_dev_access(user_id, role, enabled)
        VALUES (NEW.id, v_role, true)
      ON CONFLICT (user_id) DO UPDATE
        SET role = EXCLUDED.role, enabled = true, updated_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rendo_dev_claim_verified_invitation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rendo_dev_on_auth_verified ON auth.users;
CREATE TRIGGER rendo_dev_on_auth_verified
AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.rendo_dev_claim_verified_invitation();
