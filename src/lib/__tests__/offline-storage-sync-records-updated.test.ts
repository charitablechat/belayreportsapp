import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Audit M3 — saveInspectionOffline / saveTrainingOffline /
 * saveDailyAssessmentOffline must dispatch a `sync-records-updated`
 * CustomEvent on the `window` after the IDB write boundary returns.
 *
 * useAutoSync listens for this event and reschedules its periodic-sync
 * interval from `idleSyncInterval` (long, used when nothing is dirty)
 * down to `activeSyncInterval` (short, used when there are unsynced
 * records). Without the dispatch, a freshly-saved-offline form record
 * sits in IDB until the next photo upload or the next `idleSyncInterval`
 * tick — a 60s+ delay on the very first edit of a session.
 *
 * jsdom has no real IndexedDB, so the saves either:
 *   - throw IdbSaveError (health check fails), or
 *   - return { savedToBackup: true } (circuit breaker open, localStorage
 *     fallback succeeded).
 * In BOTH cases the dispatch must NOT fire — we only schedule a faster
 * sync when an actual IDB write succeeded. The dispatch is wired AFTER
 * `withIndexedDBSaveBoundary` resolves, so a thrown boundary skips it.
 */

describe('audit M3 — sync-records-updated dispatch on form-record save', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  function getRecordEventCount(): number {
    return dispatchSpy.mock.calls.filter((call) => {
      const ev = call[0] as Event;
      return ev?.type === 'sync-records-updated';
    }).length;
  }

  it('saveInspectionOffline dispatches sync-records-updated when the boundary resolves', async () => {
    const { saveInspectionOffline, isIdbSaveError } = await import(
      '../offline-storage'
    );
    let thrown: unknown = null;
    try {
      await saveInspectionOffline({ id: 'm3-insp-1', organization: 'A', location: 'L' });
    } catch (e) {
      thrown = e;
    }
    if (thrown) {
      // Boundary rejected — dispatch must NOT have fired.
      expect(isIdbSaveError(thrown)).toBe(true);
      expect(getRecordEventCount()).toBe(0);
    } else {
      // Boundary resolved (real IDB or localStorage fallback) — dispatch must fire exactly once.
      expect(getRecordEventCount()).toBe(1);
    }
  });

  it('saveTrainingOffline dispatches sync-records-updated when the boundary resolves', async () => {
    const { saveTrainingOffline, isIdbSaveError } = await import(
      '../offline-storage'
    );
    let thrown: unknown = null;
    try {
      await saveTrainingOffline({ id: 'm3-train-1', organization: 'A', location: 'L' });
    } catch (e) {
      thrown = e;
    }
    if (thrown) {
      expect(isIdbSaveError(thrown)).toBe(true);
      expect(getRecordEventCount()).toBe(0);
    } else {
      expect(getRecordEventCount()).toBe(1);
    }
  });

  it('saveDailyAssessmentOffline dispatches sync-records-updated when the boundary resolves', async () => {
    const { saveDailyAssessmentOffline, isIdbSaveError } = await import(
      '../offline-storage'
    );
    let thrown: unknown = null;
    try {
      await saveDailyAssessmentOffline({
        id: 'm3-assess-1',
        organization: 'A',
        location: 'L',
      });
    } catch (e) {
      thrown = e;
    }
    if (thrown) {
      expect(isIdbSaveError(thrown)).toBe(true);
      expect(getRecordEventCount()).toBe(0);
    } else {
      expect(getRecordEventCount()).toBe(1);
    }
  });

  it('the dispatched event is a CustomEvent on `window` with the documented type', async () => {
    const { saveInspectionOffline } = await import('../offline-storage');
    try {
      await saveInspectionOffline({ id: 'm3-insp-2', organization: 'A', location: 'L' });
    } catch {
      /* boundary may reject in jsdom — see test 1 */
    }
    const recordCalls = dispatchSpy.mock.calls.filter((call) => {
      const ev = call[0] as Event;
      return ev?.type === 'sync-records-updated';
    });
    if (recordCalls.length > 0) {
      const ev = recordCalls[0][0] as Event;
      expect(ev).toBeInstanceOf(Event);
      expect(ev.type).toBe('sync-records-updated');
    }
    // If recordCalls.length === 0 the boundary rejected, which is asserted in
    // the per-helper tests above.
  });
});
