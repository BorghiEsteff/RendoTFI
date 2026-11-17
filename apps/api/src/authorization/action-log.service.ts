import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

export interface LogActionParams {
  gestorId: string;
  actorId: string;
  actorRol: 'gestor' | 'delegado' | 'admin';
  accion: string;
  recursoTipo: string;
  recursoId?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionLogRecord {
  id: string;
  gestor_id: string;
  actor_id: string;
  actor_rol: string;
  accion: string;
  recurso_tipo: string;
  recurso_id?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

@Injectable()
export class ActionLogService {
  private readonly logger = new Logger(ActionLogService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Appends an immutable actor-attributed action record into log_acciones.
   * Throws on failure to guarantee audit completeness.
   */
  async logAction(params: LogActionParams): Promise<void> {
    const client = this.supabaseService.getAdminClient();
    const { error } = await client.from('log_acciones').insert({
      gestor_id: params.gestorId,
      actor_id: params.actorId,
      actor_rol: params.actorRol,
      accion: params.accion,
      recurso_tipo: params.recursoTipo,
      recurso_id: params.recursoId || null,
      metadata: params.metadata || {},
    });

    if (error) {
      this.logger.error(`Error logging action ${params.accion}: ${error.message}`);
      throw new InternalServerErrorException(`Fallo en el registro de auditoría: ${error.message}`);
    }
  }

  /**
   * Authoritative retrieval of action logs for the Gestor owner.
   */
  async getLogs(
    gestorId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ data: Array<ActionLogRecord & {
    actor_nombre: string | null;
    objetivo_nombre: string | null;
    recurso_nombre: string | null;
  }>; total: number }> {
    // El endpoint está protegido por assertOwnerOnly; nunca aceptar gestorId del cliente.
    const safeLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.trunc(limit))) : 50;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
    const client = this.supabaseService.getAdminClient();
    const { data, error, count } = await client
      .from('log_acciones')
      .select('*', { count: 'exact' })
      .eq('gestor_id', gestorId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1);

    if (error) {
      this.logger.error('Error al leer auditoría: ' + error.message);
      throw new InternalServerErrorException('No se pudo consultar el historial de actividad');
    }

    const logs = (data ?? []) as ActionLogRecord[];
    const unique = (values: Array<string | null | undefined>) =>
      [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];

    // Consultas por lote: evita una petición por evento e incluye los registros históricos.
    // La falla de enriquecimiento nunca inventa nombres ni elimina eventos de auditoría.
    const read = async (table: string, ids: string[], columns: string): Promise<Array<Record<string, any>>> => {
      if (ids.length === 0) return [];
      const { data: rows, error: lookupError } = await client.from(table).select(columns).in('id', ids);
      if (lookupError) {
        this.logger.warn('No se pudo enriquecer auditoría (' + table + '): ' + lookupError.message);
        return [];
      }
      return (rows ?? []) as Array<Record<string, any>>;
    };
    const metadata = (log: ActionLogRecord): Record<string, unknown> =>
      log.metadata && typeof log.metadata === 'object' ? log.metadata : {};

    const inviteIds = unique(logs.filter(l => l.recurso_tipo === 'invitacion').map(l => l.recurso_id));
    const delegationIds = unique(logs.filter(l => l.recurso_tipo === 'delegacion').map(l => l.recurso_id));
    const unitIds = unique(logs.filter(l => l.recurso_tipo === 'unidades').map(l => l.recurso_id));
    const groupIds = unique(logs.filter(l => l.recurso_tipo === 'grupos').map(l => l.recurso_id));
    const tenantIds = unique(logs.filter(l => l.recurso_tipo === 'inquilinos').map(l => l.recurso_id));
    const rentalIds = unique(logs.filter(l => l.recurso_tipo === 'alquileres').map(l => l.recurso_id));
    const tariffIds = unique(logs.filter(l => l.recurso_tipo === 'modalidades_precio').map(l => l.recurso_id));

    const [invitations, delegations, units, groups, tenants, rentals, tariffs] = await Promise.all([
      read('invitaciones_delegados', inviteIds, 'id,delegado_id'),
      read('delegaciones', delegationIds, 'id,delegado_id'),
      read('unidades', unitIds, 'id,titulo_es'),
      read('grupos', groupIds, 'id,nombre'),
      read('inquilinos', tenantIds, 'id,nombre_completo'),
      read('alquileres', rentalIds, 'id,unidad_id'),
      read('modalidades_precio', tariffIds, 'id,unidad_id'),
    ]);

    const byId = (rows: Array<Record<string, any>>) =>
      new Map<string, Record<string, any>>(rows.map(row => [String(row.id), row]));
    const invitationById = byId(invitations);
    const delegationById = byId(delegations);
    const rentalsById = byId(rentals);
    const tariffsById = byId(tariffs);
    const additionalUnitIds = unique([
      ...rentals.map(r => r.unidad_id),
      ...tariffs.map(t => t.unidad_id),
    ]).filter(id => !unitIds.includes(id));
    const extraUnits = await read('unidades', additionalUnitIds, 'id,titulo_es');
    const unitById = byId([...units, ...extraUnits]);
    const groupById = byId(groups);
    const tenantById = byId(tenants);

    const userIds = unique([
      ...logs.map(l => l.actor_id),
      ...invitations.map(i => i.delegado_id),
      ...delegations.map(d => d.delegado_id),
      ...logs.map(l => metadata(l).delegado_id as string | undefined),
    ]);
    const userById = byId(await read('users', userIds, 'id,full_name'));
    const displayName = (id: unknown): string | null => {
      if (typeof id !== 'string') return null;
      const name = userById.get(id)?.full_name;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    };
    const unitName = (id: unknown): string | null => {
      if (typeof id !== 'string') return null;
      const title = unitById.get(id)?.titulo_es;
      return typeof title === 'string' && title.trim() ? title.trim() : null;
    };

    return {
      total: count ?? logs.length,
      data: logs.map(log => {
        const meta = metadata(log);
        const ref = log.recurso_id;
        let recursoNombre: string | null = null;
        let objetivoId: unknown = meta.delegado_id;
        if (log.recurso_tipo === 'invitacion') {
          objetivoId = invitationById.get(ref ?? '')?.delegado_id ?? objetivoId;
        } else if (log.recurso_tipo === 'delegacion') {
          objetivoId = delegationById.get(ref ?? '')?.delegado_id ?? objetivoId;
        } else if (log.recurso_tipo === 'unidades') {
          recursoNombre = unitName(ref);
        } else if (log.recurso_tipo === 'grupos') {
          recursoNombre = groupById.get(ref ?? '')?.nombre ?? null;
        } else if (log.recurso_tipo === 'inquilinos') {
          recursoNombre = tenantById.get(ref ?? '')?.nombre_completo ?? null;
        } else if (log.recurso_tipo === 'alquileres') {
          recursoNombre = unitName(rentalsById.get(ref ?? '')?.unidad_id);
        } else if (log.recurso_tipo === 'modalidades_precio') {
          recursoNombre = unitName(tariffsById.get(ref ?? '')?.unidad_id);
        }
        return {
          ...log,
          actor_nombre: displayName(log.actor_id),
          objetivo_nombre: displayName(objetivoId),
          recurso_nombre: recursoNombre,
        };
      }),
    };
  }
}
