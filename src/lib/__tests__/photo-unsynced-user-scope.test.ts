import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * S43 — `getUnuploadedPhotos(userId)` and `getDeadLetterPhotos(userId)` MUST
 * scope by user. Before this fix, both ignored the supplied userId and
 * returned every `uploaded === 0` photo on the device, producing the
 * "stuck 50 pending" badge on shared / long-lived devices where photos
 * accumulated for inspections owned by other users or for inspections that
 * had since been deleted/evicted from IDB.
 *
 * Contracts locked here:
 *   1. capturedByUserId === A → excluded from getUnuploadedPhotos(B).
 *   2. No capturedByUserId, parent.inspector_id === A → excluded from getUnuploadedPhotos(B).
 *   3. No capturedByUserId, no parent in IDB, temp-* parent → still returned (orphan recovery).
 *   4. UUID parent missing from IDB → routed to getDeadLetterPhotos, NOT getUnuploadedPhotos.
 */

const DB_NAME = 'rope-works-inspections';

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

async function seedInspection(
  mod: typeof import('../offline-storage'),
  id: string,
  inspectorId: string,
) {
  await mod.saveInspectionOffline({
    id,
    inspector_id: inspectorId,
    organization: `Org ${id}`,
    status: 'draft',
    updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  });
}

async function seedPhoto(
  mod: typeof import('../offline-storage'),
  id: string,
  inspectionId: string,
  capturedByUserId: string | null,
) {
  await mod.savePhotoOffline({
    id,
    inspectionId,
    section: 'systems',
    blob: new Blob([id], { type: 'image/jpeg' }),
    fileName: `${id}.jpg`,
    uploaded: false,
    capturedByUserId,
  } as never);
}

describe('S43 — photo pending count is user-scoped', () => {
  beforeEach(() => deleteDb());

  it('excludes photos with capturedByUserId === A from getUnuploadedPhotos(B)', async () => {
    const mod = await import('../offline-storage');
    // Both photos have legitimate parents, only differ by capturedByUserId.
    await seedInspection(mod, 'insp-shared', USER_B);
    await seedPhoto(mod, 'photo-A', 'insp-shared', USER_A);
    await seedPhoto(mod, 'photo-B', 'insp-shared', USER_B);

    const out = (await mod.getUnuploadedPhotos(USER_B)) as Array<{ id: string }>;
    const ids = out.map((p) => p.id);
    expect(ids).toContain('photo-B');
    expect(ids).not.toContain('photo-A');
  });

  it('excludes photos whose parent inspector_id === A and capturedByUserId is unset, from getUnuploadedPhotos(B)', async () => {
    const mod = await import('../offline-storage');
    await seedInspection(mod, 'insp-userA', USER_A);
    await seedInspection(mod, 'insp-userB', USER_B);
    await seedPhoto(mod, 'photo-on-A', 'insp-userA', null);
    await seedPhoto(mod, 'photo-on-B', 'insp-userB', null);

    const out = (await mod.getUnuploadedPhotos(USER_B)) as Array<{ id: string }>;
    const ids = out.map((p) => p.id);
    expect(ids).toContain('photo-on-B');
    expect(ids).not.toContain('photo-on-A');
  });

  it('keeps temp-* orphan photos with no capturedByUserId visible (orphan-recovery path)', async () => {
    const mod = await import('../offline-storage');
    // No parent inspection saved — temp-* orphan with no user tag.
    await seedPhoto(mod, 'photo-orphan-temp', 'temp-abc-123', null);

    const out = (await mod.getUnuploadedPhotos(USER_B)) as Array<{ id: string }>;
    const ids = out.map((p) => p.id);
    expect(ids).toContain('photo-orphan-temp');
  });

  it('routes UUID-orphan photos to getDeadLetterPhotos, not getUnuploadedPhotos', async () => {
    const mod = await import('../offline-storage');
    // UUID parent that does NOT exist in IDB.
    const ghostUuid = '99999999-9999-9999-9999-999999999999';
    // Tag with current user so the user-scope filter doesn't drop it for a
    // different reason — we want to prove the orphan check is what excludes it.
    await seedPhoto(mod, 'photo-ghost', ghostUuid, USER_B);

    const pending = (await mod.getUnuploadedPhotos(USER_B)) as Array<{ id: string }>;
    expect(pending.find((p) => p.id === 'photo-ghost')).toBeUndefined();

    const dead = (await mod.getDeadLetterPhotos(USER_B)) as Array<{ id: string }>;
    expect(dead.find((p) => p.id === 'photo-ghost')).toBeDefined();
  });

  it('getDeadLetterPhotos(B) does not return photos captured by user A', async () => {
    const mod = await import('../offline-storage');
    // No parent — so without the capturedByUserId filter it would come back
    // as a temp-orphan-style entry on the dead-letter path.
    await seedPhoto(mod, 'photo-deadA', 'temp-xyz', USER_A);

    const dead = (await mod.getDeadLetterPhotos(USER_B)) as Array<{ id: string }>;
    expect(dead.find((p) => p.id === 'photo-deadA')).toBeUndefined();
  });
});
