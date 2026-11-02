import {getClientSessionToken} from '@/lib/supabase/client-auth';
import {createClient} from '@/lib/supabase/client';

/**
 * Resolve the current user's Bearer token. Synthetic demo credentials are
 * available only in the local test adapter; production uses Supabase Auth.
 */
export async function getDelegationAccessToken(): Promise<string | null> {
  const localToken = getClientSessionToken();
  if (localToken) return localToken;

  try {
    const {data, error} = await createClient().auth.getSession();
    if (error || !data.session?.access_token) return null;
    return data.session.access_token;
  } catch {
    return null;
  }
}
