import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/**
 * Mode B — Cross-device "recurring pending sync" loop.
 *
 * Repro path (without this fix):
 *   1. Device A and Device B both signed in as the same user.
 *   2. User edits record X on Device A. Device A syncs the edit.
 *   3. Server broadcasts Realtime UPDATE to Device B.
 *   4. Device B's `useAutoSync.handleRemoteChange` persists the payload via
 *      `saveTrainingOffline`/`saveInspectionOffline`/`saveDailyAssessmentOffline`.
 *   5. Those user-facing save helpers ALWAYS stamp `dirty: true`.
 *   6. Next `getUnsynced*` cycle on Device B sees `dirty === true` → re-flags
 *      the record as unsynced → fires another sync → broadcasts another
 *      Realtime echo back to Device A → loop.
 *
 * The fix routes Realtime ingest through `ingestRemoteRecordOffline`, which:
 *   - writes `dirty: false` (server already has the row),
 *   - sets `synced_at: record.updated_at` (no drift),
 *   - does NOT dispatch `sync-records-updated` (would needlessly poke autosync).
 *
 * These tests lock that contract using `fake-indexeddb` so the boundary
 * helpers / schema / drift logic run end-to-end.
 */

beforeEach(async () => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  vi.resetModules();
});

describe('Mode B — ingestRemoteRecordOffline contract', () => {
  it('writes the row with dirty:false even if the payload was missing dirty', async () => {
    const { ingestRemoteRecordOffline, getDB } = await import('../offline-storage');
    const updated = new Date('2025-06-01T10:00:00Z').toISOString();
    await ingestRemoteRecordOffline('inspections', {
      id: 'insp-from-remote',
      organization: 'Acme',
      updated_at: updated,
    });
    const db = await getDB();
    const row = (await db.get('inspections', 'insp-from-remote')) as {
      dirty?: boolean;
      synced_at?: string;
      updated_at?: string;
    };
    expect(row).toBeDefined();
    expect(row.dirty).toBe(false);
    expect(row.synced_at).toBe(updated);
    expect(row.updated_at).toBe(updated);
  });

  it('overrides a stale dirty:true on an incoming payload', async () => {
    // Even if the server (or another device's IDB upgrade) sent dirty=true,
    // the ingest path MUST clear it — otherwise the loop reopens.
    const { ingestRemoteRecordOffline, getDB } = await import('../offline-storage');
    const updated = new Date('2025-06-01T10:00:00Z').toISOString();
    await ingestRemoteRecordOffline('inspections', {
      id: 'insp-stale-dirty',
      organization: 'Acme',
      updated_at: updated,
      dirty: true,
    });
    const db = await getDB();
    const row = (await db.get('inspections', 'insp-stale-dirty')) as { dirty?: boolean };
    expect(row.dirty).toBe(false);
  });

  it('falls back to now() for synced_at when the payload has no updated_at', async () => {
    const { ingestRemoteRecordOffline, getDB } = await import('../offline-storage');
    const before = Date.now();
    await ingestRemoteRecordOffline('trainings', {
      id: 'trn-no-updated-at',
      organization: 'Acme',
    });
    const after = Date.now();
    const db = await getDB();
    const row = (await db.get('trainings', 'trn-no-updated-at')) as { synced_at?: string };
    expect(row.synced_at).toBeDefined();
    const syncedMs = new Date(row.synced_at!).getTime();
    expect(syncedMs).toBeGreaterThanOrEqual(before);
    expect(syncedMs).toBeLessThanOrEqual(after);
  });

  it('makes the record invisible to getUnsynced* immediately (no drift, no dirty)', async () => {
    const {
      ingestRemoteRecordOffline,
      getUnsyncedInspections,
      getUnsyncedTrainings,
      getUnsyncedDailyAssessments,
    } = await import('../offline-storage');
    const updated = new Date('2025-06-01T10:00:00Z').toISOString();
    await ingestRemoteRecordOffline('inspections', {
      id: 'insp-clean',
      organization: 'Acme',
      inspector_id: 'user-1',
      updated_at: updated,
    });
    await ingestRemoteRecordOffline('trainings', {
      id: 'trn-clean',
      organization: 'Acme',
      inspector_id: 'user-1',
      updated_at: updated,
    });
    await ingestRemoteRecordOffline('daily_assessments', {
      id: 'asm-clean',
      organization: 'Acme',
      inspector_id: 'user-1',
      updated_at: updated,
    });

    const ins = (await getUnsyncedInspections('user-1')) as Array<{ id: string }>;
    const trn = (await getUnsyncedTrainings('user-1')) as Array<{ id: string }>;
    const asm = (await getUnsyncedDailyAssessments('user-1')) as Array<{ id: string }>;
    expect(ins.find((r) => r.id === 'insp-clean')).toBeUndefined();
    expect(trn.find((r) => r.id === 'trn-clean')).toBeUndefined();
    expect(asm.find((r) => r.id === 'asm-clean')).toBeUndefined();
  });

  it('does NOT dispatch sync-records-updated (would needlessly poke autosync)', async () => {
    // The user-facing saveXOffline helpers fire this event so the autosync
    // scheduler drops from idle interval to active interval. Realtime ingest
    // must NOT fire it because the record is already synced — firing would
    // amplify the cross-device loop (each cross-device write would
    // accelerate every connected device's autosync cadence).
    const { ingestRemoteRecordOffline } = await import('../offline-storage');
    let dispatched = false;
    const listener = () => {
      dispatched = true;
    };
    window.addEventListener('sync-records-updated', listener);
    try {
      await ingestRemoteRecordOffline('inspections', {
        id: 'insp-no-dispatch',
        organization: 'Acme',
        updated_at: new Date().toISOString(),
      });
    } finally {
      window.removeEventListener('sync-records-updated', listener);
    }
    expect(dispatched).toBe(false);
  });

  it('does NOT loop: re-ingest of the same record stays clean', async () => {
    // Tablet+desktop reality: after Device A syncs, Device A's OWN realtime
    // echo arrives back at Device A (the self-write suppression in
    // handleRemoteChange runs AFTER persistToIDB). With saveXOffline this
    // re-flagged the record dirty. With ingestRemoteRecordOffline it must
    // stay clean across repeated ingests.
    const { ingestRemoteRecordOffline, getUnsyncedInspections } = await import(
      '../offline-storage'
    );
    const updated = new Date('2025-06-01T10:00:00Z').toISOString();
    for (let i = 0; i < 5; i++) {
      await ingestRemoteRecordOffline('inspections', {
        id: 'insp-no-loop',
        organization: 'Acme',
        inspector_id: 'user-1',
        updated_at: updated,
      });
    }
    const ins = (await getUnsyncedInspections('user-1')) as Array<{ id: string }>;
    expect(ins.find((r) => r.id === 'insp-no-loop')).toBeUndefined();
  });
});
