import { describe, it, expect, vi } from 'vitest';

// vi.mock must run before the atomic-sync-manager import so its module-graph
// dependencies (supabase client, toasts, offline-storage) don't try to boot.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));
vi.mock('@/components/ui/sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { safePostSyncSave } from '../atomic-sync-manager';

/**
 * N-A — reconcileBlocked suppresses synced_at stamping.
 *
 * When deferred reconcile is blocked by a safety tripwire the parent + children
 * DID commit on the server, but the user's intentional child-row deletions were
 * not propagated. `safePostSyncSave` MUST leave synced_at alone so the next
 * cycle re-flags the record via `getUnsynced*` and reconcile gets another shot.
 * Stamping synced_at here would let the deletions silently die.
 */
describe('N-A — safePostSyncSave reconcileBlocked behaviour', () => {
  it('default (reconcileBlocked=false): stamps synced_at + updated_at, clears dirty', async () => {
    const t0 = {
      id: 'abc',
      updated_at: '2025-01-01T12:00:00.000Z',
      dirty: true,
      organization: 'Acme',
    } as any;
    const saved: any[] = [];
    await safePostSyncSave(
      'abc',
      t0,
      Date.parse(t0.updated_at),
      '2025-01-01T12:00:05.000Z',
      { inspector: { first_name: 'Ada', last_name: null, avatar_url: null } } as any,
      async () => null,
      async (r) => { saved.push(r); return r; },
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].synced_at).toBe('2025-01-01T12:00:05.000Z');
    expect(saved[0].updated_at).toBe('2025-01-01T12:00:05.000Z');
    expect(saved[0].dirty).toBe(false);
    expect(saved[0].inspector).toEqual({ first_name: 'Ada', last_name: null, avatar_url: null });
  });

  it('reconcileBlocked=true: does NOT stamp synced_at and does NOT clear dirty', async () => {
    const t0 = {
      id: 'abc',
      updated_at: '2025-01-01T12:00:00.000Z',
      dirty: true,
      organization: 'Acme',
      synced_at: '2024-12-31T00:00:00.000Z', // pre-existing value must be preserved
    } as any;
    const live = {
      ...t0,
      inspector: null,
    };
    const saved: any[] = [];
    await safePostSyncSave(
      'abc',
      t0,
      Date.parse(t0.updated_at),
      '2025-01-01T12:00:05.000Z',
      { inspector: { first_name: 'Ada', last_name: null, avatar_url: null } } as any,
      async () => live,
      async (r) => { saved.push(r); return r; },
      { reconcileBlocked: true },
    );
    expect(saved).toHaveLength(1);
    // synced_at must be unchanged from the live value so getUnsynced* re-flags it
    expect(saved[0].synced_at).toBe('2024-12-31T00:00:00.000Z');
    // updated_at must be unchanged from live (server timestamp NOT applied)
    expect(saved[0].updated_at).toBe('2025-01-01T12:00:00.000Z');
    // merged fields are still merged (inspector profile attached)
    expect(saved[0].inspector).toEqual({ first_name: 'Ada', last_name: null, avatar_url: null });
    // dirty is not cleared — next cycle will pick this up
    expect(saved[0].dirty).toBe(true);
  });

  it('reconcileBlocked=true + concurrent edit: leaves live record untouched', async () => {
    const t0UpdatedAt = '2025-01-01T12:00:00.000Z';
    const liveUpdatedAt = '2025-01-01T12:00:03.000Z'; // concurrent edit
    const t0 = { id: 'abc', updated_at: t0UpdatedAt, dirty: true } as any;
    const live = {
      id: 'abc',
      updated_at: liveUpdatedAt,
      dirty: true,
      notes: 'user typed this during sync',
      synced_at: '2024-12-31T00:00:00.000Z',
    };
    const saved: any[] = [];
    await safePostSyncSave(
      'abc',
      t0,
      Date.parse(t0UpdatedAt),
      '2025-01-01T12:00:05.000Z',
      { inspector: { first_name: 'Ada', last_name: null, avatar_url: null } } as any,
      async () => live,
      async (r) => { saved.push(r); return r; },
      { reconcileBlocked: true },
    );
    // reconcile blocked + concurrent edit = do not write at all, per comments.
    expect(saved).toHaveLength(0);
  });

  it('default + concurrent edit: stamps synced_at only, preserves live record', async () => {
    const t0UpdatedAt = '2025-01-01T12:00:00.000Z';
    const liveUpdatedAt = '2025-01-01T12:00:03.000Z';
    const t0 = { id: 'abc', updated_at: t0UpdatedAt } as any;
    const live = {
      id: 'abc',
      updated_at: liveUpdatedAt,
      dirty: true,
      notes: 'user typed this during sync',
    };
    const saved: any[] = [];
    await safePostSyncSave(
      'abc',
      t0,
      Date.parse(t0UpdatedAt),
      '2025-01-01T12:00:05.000Z',
      { inspector: { first_name: null, last_name: null, avatar_url: null } } as any,
      async () => live,
      async (r) => { saved.push(r); return r; },
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].notes).toBe('user typed this during sync');
    expect(saved[0].updated_at).toBe(liveUpdatedAt); // live timestamp preserved
    expect(saved[0].synced_at).toBe('2025-01-01T12:00:05.000Z');
    expect(saved[0].dirty).toBe(true); // live.dirty preserved
  });
});
