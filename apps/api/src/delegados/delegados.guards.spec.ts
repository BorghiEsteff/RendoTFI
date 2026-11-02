import 'reflect-metadata';
import {describe, expect, it} from 'vitest';
import {DelegadosController} from './delegados.controller.js';
import {SupabaseAuthGuard} from '../auth/supabase-auth.guard.js';
import {SupabasePublicAuthGuard} from '../auth/supabase-public-auth.guard.js';

function guardsFor(method: keyof DelegadosController): unknown[] {
  const handler = DelegadosController.prototype[method];
  return Reflect.getMetadata('__guards__', handler) || [];
}

describe('delegation invitation endpoint guards', () => {
  it('allows registered buscadores to view and answer only their own invitations', () => {
    expect(Reflect.getMetadata('__guards__', DelegadosController)).toBeUndefined();
    for (const method of ['listReceivedInvitations', 'acceptInvitation', 'rejectInvitation'] as const) {
      expect(guardsFor(method)).toEqual([SupabasePublicAuthGuard]);
    }
  });

  it('preserves the operational role guard on owner-only and scope endpoints', () => {
    for (const method of [
      'getAccessContext', 'getLogs', 'listDelegados',
      'createInvitation', 'invitar', 'cancelInvitation',
      'configureDelegado', 'revokeDelegado'
    ] as const) {
      expect(guardsFor(method)).toEqual([SupabaseAuthGuard]);
    }
  });
});
