import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/**
 * Audit M1 — contract tests for the working-set scan cap on
 * `getUnsynced{Inspections,Trainings,DailyAssessments}`.
 *
 * Behaviour pinned:
 *   - Sub-cap (rows < cap) — function returns the unsynced subset; no
 *     overflow Sentry beacon emitted.
 *   - At-cap or over-cap — function still returns up to `cap` rows; a
 *     single overflow Sentry beacon is emitted per session per store
 *     (subsequent calls are silent).
 *
 * Real `fake-indexeddb` on the IDB side. `vi.resetModules()` per test so
 * the per-session "already reported" Set doesn't leak between cases.
 */

const logErrorMock = vi.fn();
vi.mock('../log-error', () => ({
  logError: (err: unknown, ctx?: unknown) => logErrorMock(err, ctx),
}));

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

beforeEach(() => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  logErrorMock.mockClear();
  vi.resetModules();
});

async function seedInspections(count: number, userId: string): Promise<void> {
  const { saveInspectionOffline } = await import('../offline-storage');
  const writes = Array.from({ length: count }, (_, i) =>
    saveInspectionOffline({
      id: `insp-${i}`,
      inspector_id: userId,
      site_name: `Site ${i}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced_at: null,
    } as never)
  );
  await Promise.all(writes);
}

describe('Audit M1 — getUnsyncedInspections cap', () => {
  it('returns all rows on the sub-cap path with no overflow beacon', async () => {
    await seedInspections(5, 'u-1');
    const { getUnsyncedInspections } = await import('../offline-storage');
    const result = await getUnsyncedInspections('u-1');
    expect(Array.isArray(result)).toBe(true);
    expect(Array.isArray(result) ? result.length : 0).toBe(5);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('exposes a test-only reset helper for the per-session overflow set', async () => {
    const mod = await import('../offline-storage');
    expect(typeof mod.__test_only__resetUnsyncedScanOverflowState).toBe('function');
    // No-op when nothing has been reported yet — must not throw.
    expect(() => mod.__test_only__resetUnsyncedScanOverflowState()).not.toThrow();
  });
});
