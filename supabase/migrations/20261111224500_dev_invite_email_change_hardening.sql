-- Security hardening: never upgrade on a changed email that may lack verification.
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
    -- Email changes must NOT reuse the previous email's confirmation.
    v_should_claim := OLD.email IS NOT DISTINCT FROM NEW.email
                      AND OLD.email_confirmed_at IS NULL
                      AND NEW.email_confirmed_at IS NOT NULL;
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
