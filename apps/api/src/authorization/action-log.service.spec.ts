import { describe, expect, it } from 'vitest';
import { ActionLogService } from './action-log.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';

type Row = Record<string, any>;

function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] || [])];
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) {
          rows = rows.filter(row => row[field] === value);
          return query;
        },
        order(field: string, options?: { ascending?: boolean }) {
          rows.sort((a, b) => {
            const av = String(a[field] ?? '');
            const bv = String(b[field] ?? '');
            return (options?.ascending ? 1 : -1) * av.localeCompare(bv);
          });
          return query;
        },
        range(start: number, end: number) {
          return Promise.resolve({ data: rows.slice(start, end + 1), count: rows.length, error: null });
        },
        in(field: string, ids: string[]) {
          return Promise.resolve({ data: rows.filter(row => ids.includes(row[field])), error: null });
        },
      };
      return query;
    },
  };
}

describe('ActionLogService — historial real y legible', () => {
  const gestor = '10000000-0000-0000-0000-000000000001';
  const delegado = '10000000-0000-0000-0000-000000000002';
  const unidad = '10000000-0000-0000-0000-000000000003';
  const invitacion = '10000000-0000-0000-0000-000000000004';
  const delegacion = '10000000-0000-0000-0000-000000000005';

  it('enriquece invitaciones, aceptación y creación de unidades sin inventar actores', async () => {
    const logs = [
      { id: 'log-1', gestor_id: gestor, actor_id: gestor, actor_rol: 'gestor', accion: 'crear_invitacion', recurso_tipo: 'invitacion', recurso_id: invitacion, metadata: { delegado_id: delegado }, created_at: '2026-11-17T10:00:00Z' },
      { id: 'log-2', gestor_id: gestor, actor_id: delegado, actor_rol: 'delegado', accion: 'aceptar_invitacion', recurso_tipo: 'invitacion', recurso_id: invitacion, metadata: {}, created_at: '2026-11-17T11:00:00Z' },
      { id: 'log-3', gestor_id: gestor, actor_id: gestor, actor_rol: 'gestor', accion: 'configurar_delegacion', recurso_tipo: 'delegacion', recurso_id: delegacion, metadata: { permiso: 'gestionar' }, created_at: '2026-11-17T12:00:00Z' },
      { id: 'log-4', gestor_id: gestor, actor_id: delegado, actor_rol: 'delegado', accion: 'crear_unidades', recurso_tipo: 'unidades', recurso_id: unidad, metadata: { op: 'INSERT' }, created_at: '2026-11-17T13:00:00Z' },
      { id: 'another-workspace', gestor_id: delegado, actor_id: delegado, actor_rol: 'gestor', accion: 'crear_unidades', recurso_tipo: 'unidades', recurso_id: unidad, metadata: {}, created_at: '2026-11-18T13:00:00Z' },
    ];
    const client = fakeClient({
      log_acciones: logs,
      users: [{ id: gestor, full_name: 'Carlos Gestor' }, { id: delegado, full_name: 'María Delegada' }],
      unidades: [{ id: unidad, titulo_es: 'Departamento Centro 2A' }],
      invitaciones_delegados: [{ id: invitacion, delegado_id: delegado }],
      delegaciones: [{ id: delegacion, delegado_id: delegado }],
    });
    const service = new ActionLogService({ getAdminClient: () => client } as unknown as SupabaseService);
    const result = await service.getLogs(gestor, 50, 0);

    expect(result.total).toBe(4);
    expect(result.data.map(event => event.id)).toEqual(['log-4', 'log-3', 'log-2', 'log-1']);
    expect(result.data[0]).toMatchObject({
      actor_nombre: 'María Delegada',
      actor_rol: 'delegado',
      recurso_nombre: 'Departamento Centro 2A',
      accion: 'crear_unidades',
    });
    expect(result.data[1].objetivo_nombre).toBe('María Delegada');
    expect(result.data[2].actor_nombre).toBe('María Delegada');
    expect(result.data[3]).toMatchObject({ actor_nombre: 'Carlos Gestor', objetivo_nombre: 'María Delegada' });
    expect(JSON.stringify(result.data)).not.toContain('another-workspace');
  });

  it('no crea nombres falsos si ya no existe el perfil del actor', async () => {
    const client = fakeClient({
      log_acciones: [{ id: 'log', gestor_id: gestor, actor_id: delegado, actor_rol: 'delegado',
        accion: 'crear_unidades', recurso_tipo: 'unidades', recurso_id: unidad, metadata: {},
        created_at: '2026-11-17T13:00:00Z' }],
      unidades: [{ id: unidad, titulo_es: 'Unidad de prueba' }],
      users: [],
    });
    const service = new ActionLogService({ getAdminClient: () => client } as unknown as SupabaseService);
    const result = await service.getLogs(gestor);
    expect(result.data[0].actor_nombre).toBeNull();
    expect(result.data[0].recurso_nombre).toBe('Unidad de prueba');
  });
});
