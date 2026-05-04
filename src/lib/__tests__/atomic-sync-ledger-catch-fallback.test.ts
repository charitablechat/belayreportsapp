import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Mode 11B (A+B composed) — atomic-sync drain catch-block ledger fallback.
 *
 * Companion to `wedge-ledger-fallback.test.ts`, which pins the
 * `withWedgeLedgerFallback` wrapper contract inside `getUnsynced*`.
 *
 * This test pins the OUTER (`atomic-sync-manager.ts`) contract: when the
 * drain's outer `Promise.race`-wrapped fetch returns `IdbReadFailure` OR
 * the outer race throws (timeout / unexpected rejection), the catch-block
 * helper consults `LocalBackupLedger` before giving up. PR #119 CI showed
 * the wrapper itself wasn't being reached in some cases (drain not even
 * ticking during the wedge window); this catch-block fallback is the
 * wider safety net.
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
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  vi.resetModules();
});

function writeLedgerSnapshot(
  reportType: 'inspection' | 'training' | 'daily_assessment',
  id: string,
  parent: Record<string, unknown>,
): void {
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

describe('Mode 11B — atomic-sync ledgerFallbackRows helper', () => {
  it('returns ledger rows for inspection type filtered by userId', async () => {
    writeLedgerSnapshot('inspection', 'insp-A', {
      id: 'insp-A',
      inspector_id: 'user-1',
      organization: 'Org',
      location: 'Loc',
    });
    writeLedgerSnapshot('inspection', 'insp-B', {
      id: 'insp-B',
      inspector_id: 'user-2',
      organization: 'Org',
      location: 'Loc',
    });

    const mod = await import('../atomic-sync-manager');
    const helper = mod.__test_only__ledgerFallbackRows;
    const rows = await helper<{ id: string }>('inspection', 'user-1', 'unit-test');

    expect(rows.map((r) => r.id)).toEqual(['insp-A']);
  });

  it('returns empty array (not throw) when ledger has no matching snapshots', async () => {
    const mod = await import('../atomic-sync-manager');
    const helper = mod.__test_only__ledgerFallbackRows;
    const rows = await helper<{ id: string }>('training', 'user-1', 'unit-test');
    expect(rows).toEqual([]);
  });

  it('returns rows for all three report types', async () => {
    writeLedgerSnapshot('inspection', 'insp-1', {
      id: 'insp-1',
      inspector_id: 'u',
    });
    writeLedgerSnapshot('training', 'train-1', {
      id: 'train-1',
      inspector_id: 'u',
    });
    writeLedgerSnapshot('daily_assessment', 'da-1', {
      id: 'da-1',
      inspector_id: 'u',
    });

    const mod = await import('../atomic-sync-manager');
    const helper = mod.__test_only__ledgerFallbackRows;

    const inspections = await helper<{ id: string }>('inspection', 'u', 'unit-test');
    const trainings = await helper<{ id: string }>('training', 'u', 'unit-test');
    const assessments = await helper<{ id: string }>('daily_assessment', 'u', 'unit-test');

    expect(inspections.map((r) => r.id)).toEqual(['insp-1']);
    expect(trainings.map((r) => r.id)).toEqual(['train-1']);
    expect(assessments.map((r) => r.id)).toEqual(['da-1']);
  });

  it('logs `Mode 11B catch-block ledger fallback active` on success path', async () => {
    writeLedgerSnapshot('inspection', 'insp-X', {
      id: 'insp-X',
      inspector_id: 'u',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../atomic-sync-manager');
    const helper = mod.__test_only__ledgerFallbackRows;
    await helper<{ id: string }>('inspection', 'u', 'unit-test-context');

    const matched = warnSpy.mock.calls.find(([msg]) =>
      typeof msg === 'string' && msg.includes('Mode 11B catch-block ledger fallback active'),
    );
    expect(matched).toBeDefined();
    expect(matched?.[1]).toMatchObject({
      context: 'unit-test-context',
      reportType: 'inspection',
      ledgerCount: 1,
    });

    warnSpy.mockRestore();
  });
});
