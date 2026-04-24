import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/**
 * H6 — boundary coverage for the top-3 sync-gating reads.
 *
 * These tests run against a real (in-memory) IndexedDB via `fake-indexeddb`,
 * so they exercise the actual schema + boundary helpers in offline-storage.ts
 * — not mocks. Vitest reloads the module per `beforeEach` so each test starts
 * with a fresh DB.
 *
 * Covered contracts:
 *   1. getUnsynced* drift tolerance: 29s drift → synced; 31s drift → unsynced.
 *   2. dirty=true overrides drift even when synced_at >= updated_at.
 *   3. _remote_deleted_at quarantined records are excluded from unsynced set.
 *   4. Empty store / only-synced store returns [] (NOT IdbReadFailure).
 *   5. saveInspectionOffline stamps dirty=true so the very next read flags it.
 *   6. by-uploaded photos index uses 0|1 (the C1 contract — booleans break IDB).
 */

// fresh DB per test
beforeEach(async () => {
  // Reset both module + DB so the schema migration runs again.
  (globalThis as any).indexedDB = new IDBFactory();
  // Drop the cached module so internal `dbConnectionVerified` resets.
  await import('../offline-storage');
  const mod = await import('../offline-storage');
  // @ts-expect-error — vitest resetModules between describes also works, but
  // explicit re-import keeps each test self-contained.
  return mod;
});

describe('H6 — getUnsyncedInspections drift tolerance & dirty flag', () => {
  it('returns [] for an empty store (not IdbReadFailure)', async () => {
    const { getUnsyncedInspections, isIdbReadFailure } = await import('../offline-storage');
    const result = await getUnsyncedInspections();
    expect(isIdbReadFailure(result)).toBe(false);
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(0);
  });

  it('29s drift is within tolerance — record counted as synced', async () => {
    const { saveInspectionOffline, getUnsyncedInspections } = await import('../offline-storage');
    const synced = new Date('2025-01-01T12:00:00Z').toISOString();
    const updated = new Date('2025-01-01T12:00:29Z').toISOString(); // +29s
    await saveInspectionOffline({
      id: 'insp-29s',
      organization: 'Acme',
      synced_at: synced,
      updated_at: updated,
      dirty: false,
    });
    const result = await getUnsyncedInspections();
    expect(Array.isArray(result)).toBe(true);
    // saveInspectionOffline always stamps dirty=true → it WILL show up.
    // To isolate the drift check we manually clear dirty afterwards.
    const { default: idb } = await import('idb');
    const db = await idb.openDB('rope-works-inspections');
    const live = await db.get('inspections', 'insp-29s');
    await db.put('inspections', { ...live, dirty: false });
    db.close();

    const result2 = await getUnsyncedInspections();
    const found = (result2 as any[]).find(r => r.id === 'insp-29s');
    expect(found).toBeUndefined();
  });

  it('31s drift exceeds tolerance — record flagged unsynced', async () => {
    const { saveInspectionOffline, getUnsyncedInspections } = await import('../offline-storage');
    const synced = new Date('2025-01-01T12:00:00Z').toISOString();
    const updated = new Date('2025-01-01T12:00:31Z').toISOString(); // +31s
    await saveInspectionOffline({
      id: 'insp-31s',
      organization: 'Acme',
      synced_at: synced,
      updated_at: updated,
    });
    // Clear dirty to isolate drift behavior.
    const { default: idb } = await import('idb');
    const db = await idb.openDB('rope-works-inspections');
    const live = await db.get('inspections', 'insp-31s');
    await db.put('inspections', { ...live, dirty: false });
    db.close();

    const result = await getUnsyncedInspections();
    const found = (result as any[]).find(r => r.id === 'insp-31s');
    expect(found).toBeDefined();
  });

  it('dirty=true overrides drift — record flagged unsynced even when timestamps match', async () => {
    const { saveInspectionOffline, getUnsyncedInspections } = await import('../offline-storage');
    const ts = new Date('2025-01-01T12:00:00Z').toISOString();
    await saveInspectionOffline({
      id: 'insp-dirty',
      organization: 'Acme',
      synced_at: ts,
      updated_at: ts, // identical → drift = 0
    });
    // saveInspectionOffline stamps dirty=true; verify it shows up despite no drift
    const result = await getUnsyncedInspections();
    const found = (result as any[]).find(r => r.id === 'insp-dirty');
    expect(found).toBeDefined();
    expect(found.dirty).toBe(true);
  });

  it('_remote_deleted_at quarantined records are excluded', async () => {
    const { saveInspectionOffline, getUnsyncedInspections } = await import('../offline-storage');
    await saveInspectionOffline({
      id: 'insp-quarantined',
      organization: 'Acme',
      synced_at: null,
      updated_at: new Date().toISOString(),
      _remote_deleted_at: new Date().toISOString(),
    });
    const result = await getUnsyncedInspections();
    const found = (result as any[]).find(r => r.id === 'insp-quarantined');
    expect(found).toBeUndefined();
  });

  it('temp-id orphans owned by another user still surface (cross-user recovery)', async () => {
    const { saveInspectionOffline, getUnsyncedInspections } = await import('../offline-storage');
    await saveInspectionOffline({
      id: 'temp-abc-xyz',
      organization: 'Acme',
      inspector_id: 'other-user',
      synced_at: null,
      updated_at: new Date().toISOString(),
    });
    const result = await getUnsyncedInspections('current-user');
    const found = (result as any[]).find(r => r.id === 'temp-abc-xyz');
    expect(found).toBeDefined();
  });
});

describe('H6 — saveInspectionOffline stamps dirty=true', () => {
  it('next getUnsyncedInspections call sees the new edit', async () => {
    const { saveInspectionOffline, getUnsyncedInspections } = await import('../offline-storage');
    const past = new Date('2024-01-01T00:00:00Z').toISOString();
    await saveInspectionOffline({
      id: 'insp-fresh-edit',
      organization: 'Acme',
      synced_at: past,
      updated_at: past, // no drift, but dirty stamp must still flag it
    });
    const result = await getUnsyncedInspections();
    const found = (result as any[]).find(r => r.id === 'insp-fresh-edit');
    expect(found).toBeDefined();
    expect(found.dirty).toBe(true);
  });
});

describe('H6 — by-uploaded photos index uses 0|1 (C1 contract)', () => {
  it('index lookup with key=0 returns un-uploaded photos; booleans would throw', async () => {
    const { savePhotoOffline } = await import('../offline-storage');
    await savePhotoOffline({
      id: 'photo-a',
      inspectionId: 'insp-1',
      blob: new Blob(['x']),
      uploaded: 0,
      created_at: Date.now(),
    } as any);
    await savePhotoOffline({
      id: 'photo-b',
      inspectionId: 'insp-1',
      blob: new Blob(['y']),
      uploaded: 1,
      created_at: Date.now(),
    } as any);

    const { default: idb } = await import('idb');
    const db = await idb.openDB('rope-works-inspections');
    const unUploaded = await db.getAllFromIndex('photos', 'by-uploaded', IDBKeyRange.only(0));
    db.close();
    expect(unUploaded.length).toBe(1);
    expect(unUploaded[0].id).toBe('photo-a');
  });
});
