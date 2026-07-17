import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/**
 * M6 — Quarantine GC + setter integration coverage.
 *
 * Exercises:
 *   1. `quarantineRecord` actually stamps `_remote_deleted_at` on the IDB
 *      row (the setter contract relied on by getUnsynced* filters).
 *   2. `getQuarantinedRecords` surfaces the quarantined row.
 *   3. `gcQuarantinedRecords` hard-deletes rows older than the TTL but
 *      preserves rows still inside the resolution window.
 *   4. `getUnsyncedInspections` continues to skip the quarantined row
 *      between quarantine and GC (regression guard for the C9 filter).
 */

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  vi.resetModules();
});

describe('M6 — quarantine setter writes _remote_deleted_at', () => {
  it('quarantineRecord stamps the field and getQuarantinedRecords surfaces it', async () => {
    const {
      saveInspectionOffline,
      quarantineRecord,
      getQuarantinedRecords,
      getDB,
    } = await import('../offline-storage');

    await saveInspectionOffline({
      id: 'insp-q1',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });

    const remoteDeletedAt = new Date().toISOString();
    const ok = await quarantineRecord('inspections', 'insp-q1', remoteDeletedAt);
    expect(ok).toBe(true);

    // Setter contract: field is on the live row.
    const db = await getDB();
    const live = await db.get('inspections', 'insp-q1');
    expect((live as any)._remote_deleted_at).toBe(remoteDeletedAt);
    expect((live as any)._quarantine_reason).toBe('remote_soft_delete');

    // Surface helper sees it.
    const list = await getQuarantinedRecords();
    expect(list.find(r => r.id === 'insp-q1')).toBeDefined();
  });

  it('getUnsyncedInspections excludes the quarantined row (C9 filter still honored)', async () => {
    const {
      saveInspectionOffline,
      quarantineRecord,
      getUnsyncedInspections,
    } = await import('../offline-storage');

    await saveInspectionOffline({
      id: 'insp-q2',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });
    await quarantineRecord('inspections', 'insp-q2', new Date().toISOString());

    const result = await getUnsyncedInspections();
    expect((result as any[]).find(r => r.id === 'insp-q2')).toBeUndefined();
  });
});

describe('M6 — gcQuarantinedRecords TTL behavior', () => {
  it('removes rows older than TTL across all three tables', async () => {
    const {
      saveInspectionOffline,
      saveTrainingOffline,
      saveDailyAssessmentOffline,
      quarantineRecord,
      gcQuarantinedRecords,
      getQuarantinedRecords,
    } = await import('../offline-storage');

    // 31 days ago — past the 30d TTL.
    const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    await saveInspectionOffline({
      id: 'insp-old',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });
    await saveTrainingOffline({
      id: 'train-old',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
    } as any);
    await saveDailyAssessmentOffline({
      id: 'da-old',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
    } as any);

    await quarantineRecord('inspections', 'insp-old', expiredAt);
    await quarantineRecord('trainings', 'train-old', expiredAt);
    await quarantineRecord('daily_assessments', 'da-old', expiredAt);

    const before = await getQuarantinedRecords();
    expect(before.length).toBe(3);

    const result = await gcQuarantinedRecords();
    expect(result.inspections).toBe(1);
    expect(result.trainings).toBe(1);
    expect(result.daily_assessments).toBe(1);
    expect(result.total).toBe(3);

    const after = await getQuarantinedRecords();
    expect(after.length).toBe(0);
  });

  it('preserves rows still inside the TTL window', async () => {
    const {
      saveInspectionOffline,
      quarantineRecord,
      gcQuarantinedRecords,
      getQuarantinedRecords,
    } = await import('../offline-storage');

    // 5 days ago — well within the 30d window.
    const recentlyDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    await saveInspectionOffline({
      id: 'insp-fresh',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });
    await quarantineRecord('inspections', 'insp-fresh', recentlyDeletedAt);

    const result = await gcQuarantinedRecords();
    expect(result.total).toBe(0);

    const after = await getQuarantinedRecords();
    expect(after.find(r => r.id === 'insp-fresh')).toBeDefined();
  });

  it('honors a custom TTL override (test hook)', async () => {
    const {
      saveInspectionOffline,
      quarantineRecord,
      gcQuarantinedRecords,
    } = await import('../offline-storage');

    // 2 days ago.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    await saveInspectionOffline({
      id: 'insp-custom-ttl',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });
    await quarantineRecord('inspections', 'insp-custom-ttl', twoDaysAgo);

    // 1-day TTL → the 2-day-old row is expired and should be removed.
    const result = await gcQuarantinedRecords(24 * 60 * 60 * 1000);
    expect(result.inspections).toBe(1);
  });
});

describe('M6 — maybeRunQuarantineGc cycle throttling', () => {
  it('does not run before reaching the cycle interval', async () => {
    const {
      saveInspectionOffline,
      quarantineRecord,
      maybeRunQuarantineGc,
      getQuarantinedRecords,
      __resetQuarantineGcStateForTests,
    } = await import('../offline-storage');

    __resetQuarantineGcStateForTests();

    const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await saveInspectionOffline({
      id: 'insp-cycle',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });
    await quarantineRecord('inspections', 'insp-cycle', expiredAt);

    // 5 ticks — well below the 20-cycle threshold.
    for (let i = 0; i < 5; i++) maybeRunQuarantineGc();
    // Yield so any (incorrectly fired) async work would have a chance.
    await new Promise(resolve => setTimeout(resolve, 0));

    const after = await getQuarantinedRecords();
    // Row must still be there — GC should not have fired yet.
    expect(after.find(r => r.id === 'insp-cycle')).toBeDefined();
  });
});

describe('C9 — e2e fixture quarantine suppression', () => {
  it('suppresses [E2E DEVIN]-marked quarantined records and removes them from IDB', async () => {
    const {
      saveInspectionOffline,
      quarantineRecord,
      getQuarantinedRecords,
      getDB,
    } = await import('../offline-storage');

    await saveInspectionOffline({
      id: 'insp-e2e-fixture',
      organization: '[E2E DEVIN] 1700000000000',
      location: 'Test Location',
      site: 'Test Site',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });
    await saveInspectionOffline({
      id: 'insp-real-conflict',
      organization: 'Acme',
      location: 'Main Gym',
      site: 'Site A',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });

    await quarantineRecord('inspections', 'insp-e2e-fixture', new Date().toISOString());
    await quarantineRecord('inspections', 'insp-real-conflict', new Date().toISOString());

    const list = await getQuarantinedRecords();
    expect(list.find(r => r.id === 'insp-e2e-fixture')).toBeUndefined();
    expect(list.find(r => r.id === 'insp-real-conflict')).toBeDefined();

    const db = await getDB();
    const e2eRow = await db.get('inspections', 'insp-e2e-fixture');
    expect(e2eRow).toBeUndefined();
  });

  it('returns an unmarked quarantined record unchanged', async () => {
    const {
      saveInspectionOffline,
      quarantineRecord,
      getQuarantinedRecords,
    } = await import('../offline-storage');

    await saveInspectionOffline({
      id: 'insp-real-only',
      organization: 'Real Org',
      location: 'Real Location',
      site: 'Real Site',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });
    await quarantineRecord('inspections', 'insp-real-only', new Date().toISOString());

    const list = await getQuarantinedRecords();
    expect(list.find(r => r.id === 'insp-real-only')).toBeDefined();
  });
});
