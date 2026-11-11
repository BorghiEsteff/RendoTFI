import { Injectable, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

@Injectable()
export class DevService {
  constructor(private readonly supabase: SupabaseService) {}

  private assertOk(error: { message: string } | null) {
    if (error) throw new InternalServerErrorException('No fue posible consultar los datos operativos');
  }

  async resumen() {
    const db = this.supabase.getAdminClient();
    const started = Date.now();
    const [units, pendingUnits, payments, logs, users] = await Promise.all([
      db.from('unidades').select('id', { head: true, count: 'exact' }).is('deleted_at', null),
      db.from('unidades').select('id', { head: true, count: 'exact' }).eq('estado', 'en_revision').is('deleted_at', null),
      db.from('pagos').select('id', { head: true, count: 'exact' }).eq('estado', 'pendiente').eq('metodo', 'efectivo'),
      db.from('log_acciones').select('id', { head: true, count: 'exact' }),
      db.from('users').select('id', { head: true, count: 'exact' }).is('deleted_at', null),
    ]);
    for (const result of [units,pendingUnits,payments,logs,users]) this.assertOk(result.error);
    return {
      checkedAt: new Date().toISOString(),
      databaseQueryMs: Date.now() - started,
      unidades: units.count ?? 0,
      moderacionPendiente: pendingUnits.count ?? 0,
      pagosPendientes: payments.count ?? 0,
      eventosAuditoria: logs.count ?? 0,
      usuariosActivos: users.count ?? 0,
    };
  }
  async moderacion() {
    const { data, error } = await this.supabase.getAdminClient().from('unidades')
      .select('id,gestor_id,titulo_es,categoria,estado,reportes_count,created_at')
      .eq('estado','en_revision').is('deleted_at',null)
      .order('reportes_count',{ascending:false}).limit(100);
    this.assertOk(error);
    return { data: data ?? [] };
  }
  async pagos() {
    const { data, error } = await this.supabase.getAdminClient().from('pagos')
      .select('id,gestor_id,metodo,monto,cupo_adquirido,estado,created_at')
      .eq('metodo','efectivo').eq('estado','pendiente')
      .order('created_at',{ascending:true}).limit(100);
    this.assertOk(error);
    return { data: data ?? [] };
  }
  async logs() {
    const { data, error } = await this.supabase.getAdminClient().from('log_acciones')
      .select('id,gestor_id,actor_id,actor_rol,accion,recurso_tipo,recurso_id,created_at')
      .order('created_at',{ascending:false}).limit(200);
    this.assertOk(error);
    return { data: data ?? [] };
  }
  async revisarUnidad(id: string, action: 'restaurar'|'suspender', actor: string) {
    const { data, error } = await this.supabase.getAdminClient().rpc('rendo_dev_review_moderation', {
      p_unit_id:id, p_action:action, p_actor_id:actor,
    });
    if (error) throw new ConflictException('No se pudo revisar esta unidad. Actualizá la lista e intentá de nuevo.');
    return { estado:data };
  }
  async revisarPago(id: string, decision: 'aprobar'|'rechazar', actor: string) {
    const { data, error } = await this.supabase.getAdminClient().rpc('rendo_dev_review_manual_payment', {
      p_payment_id:id, p_decision:decision, p_actor_id:actor,
    });
    if (error) throw new ConflictException('No se pudo revisar este pago. Actualizá la lista e intentá de nuevo.');
    return { estado:data };
  }
}
