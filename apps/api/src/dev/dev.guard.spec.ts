import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevGuard } from './dev.guard.js';

describe('DevGuard security gates', () => {
  const originalMode = process.env.RENDO_BETA_MODE;
  const originalEnabled = process.env.RENDO_DEV_DASHBOARD_ENABLED;
  afterEach(() => {
    if (originalMode === undefined) delete process.env.RENDO_BETA_MODE;
    else process.env.RENDO_BETA_MODE = originalMode;
    if (originalEnabled === undefined) delete process.env.RENDO_DEV_DASHBOARD_ENABLED;
    else process.env.RENDO_DEV_DASHBOARD_ENABLED = originalEnabled;
  });

  const userId = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  const getUser = vi.fn();
  const maybeSingle = vi.fn();
  const supabase = {
    getClient: vi.fn(() => ({ auth: { getUser } })),
    getAdminClient: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    })),
  };
  const guard = new DevGuard(supabase as any);
  const makeContext = (authorization?: string) => {
    const request: any = { headers: { authorization } };
    return {
      request,
      context: { switchToHttp: () => ({ getRequest: () => request }) } as any,
    };
  };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RENDO_BETA_MODE = 'true';
    process.env.RENDO_DEV_DASHBOARD_ENABLED = 'true';
    getUser.mockResolvedValue({ data: { user: { id:userId,email:'verified@example.invalid',email_confirmed_at:'2026-11-11',user_metadata:{role:'admin'} } }, error:null });
    maybeSingle.mockResolvedValue({ data: { role:'dev',enabled:true }, error:null });
  });

  it('rejects routes when not in beta', async () => {
    process.env.RENDO_BETA_MODE = 'false';
    await expect(guard.canActivate(makeContext('Bearer valid').context)).rejects.toThrow('Consola no habilitada');
    expect(getUser).not.toHaveBeenCalled();
  });
  it('rejects missing credentials', async () => {
    await expect(guard.canActivate(makeContext().context)).rejects.toThrow('Autenticación requerida');
  });
  it('rejects unverified users even with user_metadata.admin', async () => {
    getUser.mockResolvedValue({ data:{user:{id:userId,user_metadata:{role:'admin'},email_confirmed_at:null}},error:null });
    await expect(guard.canActivate(makeContext('Bearer valid').context)).rejects.toThrow('Cuenta no verificada');
  });
  it('rejects user_metadata spoofing when no server-granted role exists', async () => {
    maybeSingle.mockResolvedValue({ data:null,error:null });
    await expect(guard.canActivate(makeContext('Bearer valid').context)).rejects.toThrow('Usuario sin acceso al panel');
  });
  it('accepts explicitly enabled dev and supplies backend identity', async () => {
    const { context, request } = makeContext('Bearer valid');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.dev).toEqual({id:userId,role:'dev',email:'verified@example.invalid'});
  });
});
