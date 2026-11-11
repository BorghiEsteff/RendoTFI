import { Injectable, InternalServerErrorException, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
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
    const [units, pendingUnits, flaggedUnits, payments, logs, users] = await Promise.all([
      db.from('unidades').select('id', { head: true, count: 'exact' }).is('deleted_at', null),
      db.from('unidades').select('id', { head: true, count: 'exact' }).eq('estado', 'en_revision').is('deleted_at', null),
      db.from('unidades').select('id', { head: true, count: 'exact' }).gt('reportes_count', 0).is('deleted_at', null),
      db.from('pagos').select('id', { head: true, count: 'exact' }).eq('estado', 'pendiente').eq('metodo', 'efectivo'),
      db.from('log_acciones').select('id', { head: true, count: 'exact' }),
      db.from('users').select('id', { head: true, count: 'exact' }).is('deleted_at', null),
    ]);
    for (const result of [units,pendingUnits,flaggedUnits,payments,logs,users]) this.assertOk(result.error);
    return {
      checkedAt: new Date().toISOString(),
      databaseQueryMs: Date.now() - started,
      unidades: units.count ?? 0,
      moderacionPendiente: pendingUnits.count ?? 0,
      publicacionesReportadas: flaggedUnits.count ?? 0,
      pagosPendientes: payments.count ?? 0,
      eventosAuditoria: logs.count ?? 0,
      usuariosActivos: users.count ?? 0,
    };
  }
  async moderacion(estado = 'todas', pagina = '1', busqueda = '') {
    const allowed = ['todas','reportadas','en_revision','publicada','suspendida',
      'pausada','no_disponible','borrador','archivada','bloqueada_por_impago'];
    if (!allowed.includes(estado)) throw new BadRequestException('Filtro de estado inválido');
    const page = Number(pagina);
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      throw new BadRequestException('Página inválida');
    }
    if (busqueda.length > 100) throw new BadRequestException('Búsqueda demasiado larga');
    const pageSize = 25;
    let query = this.supabase.getAdminClient().from('unidades')
      .select('id,gestor_id,titulo_es,categoria,estado,reportes_count,created_at,updated_at',
        { count:'exact' })
      .is('deleted_at',null);
    if (estado === 'reportadas') query = query.gt('reportes_count',0);
    else if (estado !== 'todas') query = query.eq('estado',estado);
    if (busqueda.trim()) query = query.ilike('titulo_es','%' + busqueda.trim() + '%');
    const { data, count, error } = await query
      .order('reportes_count',{ascending:false})
      .order('created_at',{ascending:false})
      .range((page-1)*pageSize,page*pageSize-1);
    this.assertOk(error);
    return { data:data ?? [], total:count ?? 0, page, pageSize };
  }
  async detalleModeracion(id: string) {
    const db = this.supabase.getAdminClient();
    const unit = await db.from('unidades')
      .select('id,titulo_es,estado,reportes_count')
      .eq('id',id).is('deleted_at',null).maybeSingle();
    this.assertOk(unit.error);
    if (!unit.data) throw new NotFoundException('La publicación no existe');
    const [reports,history] = await Promise.all([
      db.from('reportes')
        .select('id,motivo,created_at',{count:'exact'})
        .eq('unidad_id',id).order('created_at',{ascending:false}).limit(100),
      db.from('log_acciones')
        .select('id,accion,actor_rol,created_at,metadata')
        .eq('recurso_tipo','unidades').eq('recurso_id',id)
        .like('accion','dev_moderacion_%')
        .order('created_at',{ascending:false}).limit(50),
    ]);
    this.assertOk(reports.error);
    this.assertOk(history.error);
    return {
      unidad:unit.data,
      reportes:reports.data ?? [],
      reportesTotal:reports.count ?? 0,
      historial:history.data ?? [],
    };
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
  async revisarUnidad(id: string, action: 'revisar'|'restaurar'|'suspender', actor: string) {
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
