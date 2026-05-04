import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/**
 * Mode 11A — `withWedgeLedgerFallback` wrapper contract.
 *
 * `getUnsynced{Inspections,Trainings,DailyAssessments}` route through this
 * wrapper. When the inner `withIndexedDBReadBoundary` returns `IdbReadFailure`
 * AND the Mode 8A layer breaker is open (= confirmed structural wedge),
 * the wrapper substitutes a `LocalBackupLedger`-sourced row list. When the
 * breaker is closed (transient error path), the failure propagates so
 * callers can preserve last-known counts.
 *
 * Real `fake-indexeddb` for the IDB side, in-memory `localStorage` shim for
 * the ledger side. `vi.resetModules()` per test so `dbPromise` and the
 * layer-breaker singleton state don't leak across cases.
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

beforeEach(async () => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  vi.resetModules();
});

function writeLedgerSnapshot(reportType: 'inspection' | 'training' | 'daily_assessment', id: string, parent: Record<string, unknown>): void {
  localStorage.setItem(
    `rw_backup_${reportType}_${id}`,
    JSON.stringify({
      v: 1,
      ts: Date.now(),
      synced: false,
      device: 'test-device',
      parent,
      children: {},
      photoMetadata: [],
    }),
  );
}

describe('Mode 11A — withWedgeLedgerFallback for getUnsyncedInspections', () => {
  it('returns IDB result on the green path (no wedge, no fallback)', async () => {
    const { saveInspectionOffline, getUnsyncedInspections, isIdbReadFailure } = await import('../offline-storage');
    await saveInspectionOffline({
      id: 'idb-only',
      organization: 'Acme',
      inspector_id: 'user-1',
    });
    // No ledger entry, no breaker trip — IDB read should succeed normally.
    const result = await getUnsyncedInspections('user-1');
    expect(isIdbReadFailure(result)).toBe(false);
    const rows = result as Array<{ id: string }>;
    expect(rows.find(r => r.id === 'idb-only')).toBeDefined();
  });

  it('falls back to ledger when breaker is open AND IDB read fails', async () => {
    const offlineStorage = await import('../offline-storage');
    const {
      __test_only__setLayerBreakerStateForTests,
      getUnsyncedInspections,
      isIdbReadFailure,
    } = offlineStorage;
    // Trip the layer breaker: when open, withIndexedDBReadBoundary returns
    // IdbReadFailure immediately, so we don't need fake-indexeddb to fail.
    __test_only__setLayerBreakerStateForTests({
      consecutiveTimeouts: 3,
      trippedAt: Date.now(),
      resetCount: 0,
    });
    // Seed the ledger with two unsynced inspections for this user.
    writeLedgerSnapshot('inspection', 'led-1', {
      inspector_id: 'user-1',
      organization: 'Acme',
      dirty: true,
    });
    writeLedgerSnapshot('inspection', 'led-2', {
      inspector_id: 'user-1',
      organization: 'Acme',
      dirty: true,
    });
    // Also seed one for a different user — should be filtered out.
    writeLedgerSnapshot('inspection', 'led-other', {
      inspector_id: 'user-2',
      organization: 'Other',
    });

    const result = await getUnsyncedInspections('user-1');
    expect(isIdbReadFailure(result)).toBe(false);
    const rows = result as Array<{ id: string }>;
    expect(rows.map(r => r.id).sort()).toEqual(['led-1', 'led-2']);
  });

  it('propagates IdbReadFailure when breaker is closed (transient error path)', async () => {
    const offlineStorage = await import('../offline-storage');
    const {
      __test_only__resetLayerBreakerForTests,
      getUnsyncedInspections,
      isIdbReadFailure,
    } = offlineStorage;
    __test_only__resetLayerBreakerForTests();

    // Force IDB to throw by stubbing indexedDB.open. fake-indexeddb's open
    // requires an actual call; we replace globalThis.indexedDB with a
    // failing factory.
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open() {
        const req: Partial<IDBOpenDBRequest> = {
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
          onblocked: null,
        };
        setTimeout(() => {
          (req as { error: Error }).error = new Error('synthetic IDB open failure');
          req.onerror?.(new Event('error'));
        }, 0);
        return req as IDBOpenDBRequest;
      },
    };

    // Even though the ledger has data, the fallback must NOT fire because
    // the breaker is closed (= transient error, not a structural wedge).
    writeLedgerSnapshot('inspection', 'should-not-be-returned', {
      inspector_id: 'user-1',
      organization: 'Acme',
    });
    const result = await getUnsyncedInspections('user-1');
    expect(isIdbReadFailure(result)).toBe(true);
  }, 10_000);

  it('falls back even when ledger is empty (returns []) — wedge masks IDB regardless', async () => {
    const offlineStorage = await import('../offline-storage');
    const {
      __test_only__setLayerBreakerStateForTests,
      getUnsyncedInspections,
      isIdbReadFailure,
    } = offlineStorage;
    __test_only__setLayerBreakerStateForTests({
      consecutiveTimeouts: 3,
      trippedAt: Date.now(),
      resetCount: 0,
    });
    // No ledger entries at all — ledger fallback returns [].
    const result = await getUnsyncedInspections('user-1');
    expect(isIdbReadFailure(result)).toBe(false);
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(0);
  });
});

describe('Mode 11A — withWedgeLedgerFallback for getUnsyncedTrainings', () => {
  it('falls back to ledger when breaker open', async () => {
    const offlineStorage = await import('../offline-storage');
    const {
      __test_only__setLayerBreakerStateForTests,
      getUnsyncedTrainings,
      isIdbReadFailure,
    } = offlineStorage;
    __test_only__setLayerBreakerStateForTests({
      consecutiveTimeouts: 3,
      trippedAt: Date.now(),
      resetCount: 0,
    });
    writeLedgerSnapshot('training', 'tr-1', {
      inspector_id: 'user-1',
      dirty: true,
    });
    // Inspection should NOT bleed into training.
    writeLedgerSnapshot('inspection', 'insp-1', {
      inspector_id: 'user-1',
      dirty: true,
    });
    const result = await getUnsyncedTrainings('user-1');
    expect(isIdbReadFailure(result)).toBe(false);
    const rows = result as Array<{ id: string }>;
    expect(rows.map(r => r.id)).toEqual(['tr-1']);
  });
});

describe('Mode 11A — withWedgeLedgerFallback for getUnsyncedDailyAssessments', () => {
  it('falls back to ledger when breaker open', async () => {
    const offlineStorage = await import('../offline-storage');
    const {
      __test_only__setLayerBreakerStateForTests,
      getUnsyncedDailyAssessments,
      isIdbReadFailure,
    } = offlineStorage;
    __test_only__setLayerBreakerStateForTests({
      consecutiveTimeouts: 3,
      trippedAt: Date.now(),
      resetCount: 0,
    });
    writeLedgerSnapshot('daily_assessment', 'da-1', {
      inspector_id: 'user-1',
      dirty: true,
    });
    const result = await getUnsyncedDailyAssessments('user-1');
    expect(isIdbReadFailure(result)).toBe(false);
    const rows = result as Array<{ id: string }>;
    expect(rows.map(r => r.id)).toEqual(['da-1']);
  });

  it('temp- ID orphan recovery: returns row even when stored owner differs from userId', async () => {
    const offlineStorage = await import('../offline-storage');
    const {
      __test_only__setLayerBreakerStateForTests,
      getUnsyncedDailyAssessments,
    } = offlineStorage;
    __test_only__setLayerBreakerStateForTests({
      consecutiveTimeouts: 3,
      trippedAt: Date.now(),
      resetCount: 0,
    });
    writeLedgerSnapshot('daily_assessment', 'temp-orphan-1', {
      inspector_id: 'someone-else',
      dirty: true,
    });
    const rows = (await getUnsyncedDailyAssessments('user-1')) as Array<{ id: string }>;
    expect(rows.map(r => r.id)).toEqual(['temp-orphan-1']);
  });
});
