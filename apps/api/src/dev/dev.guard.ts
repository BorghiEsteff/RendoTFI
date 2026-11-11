import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import type { Request } from 'express';

export interface DevRequest extends Request {
  dev: { id: string; role: 'dev' | 'admin'; email?: string };
}

@Injectable()
export class DevGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Fail closed by default; the regular production application stays inaccessible.
    if (process.env.RENDO_BETA_MODE !== 'true' || process.env.RENDO_DEV_DASHBOARD_ENABLED !== 'true') {
      throw new ForbiddenException('Consola no habilitada');
    }
    const request = context.switchToHttp().getRequest<DevRequest>();
    const auth = request.headers.authorization;
    if (!auth || !/^Bearer [^\s]+$/.test(auth)) throw new UnauthorizedException('Autenticación requerida');
    const token = auth.slice(7);
    const { data, error } = await this.supabase.getClient(token).auth.getUser(token);
    if (error || !data?.user?.id || !data.user.email_confirmed_at) {
      throw new UnauthorizedException('Cuenta no verificada');
    }
    // Never authorize through user_metadata: clients can alter it.
    const { data: access, error: accessError } = await this.supabase.getAdminClient()
      .from('rendo_dev_access')
      .select('role,enabled')
      .eq('user_id', data.user.id)
      .maybeSingle();
    if (accessError || !access?.enabled || !['dev','admin'].includes(access.role)) {
      throw new ForbiddenException('Usuario sin acceso al panel');
    }
    request.dev = { id: data.user.id, email: data.user.email, role: access.role as 'dev' | 'admin' };
    return true;
  }
}
