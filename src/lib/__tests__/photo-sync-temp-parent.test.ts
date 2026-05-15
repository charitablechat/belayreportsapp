/**
 * Photo-sync — temp-parent skip MUST NOT bump retryCount.
 *
 * Regression fix for the audit's "50 pending photos that never drain"
 * report on cross-device iPad users.
 *
 * Before this fix, `sync-manager.ts`'s temp-parent skip path called
 * `incrementPhotoRetryCount(photo.id)` on every cycle where the photo's
 * parent was still on a `temp-*` id. With `MAX_PHOTO_RETRIES = 5` and
 * the ~30s active sync cadence, a slow-to-sync parent could push
 * otherwise-healthy photos into dead-letter in ~2.5 min — well within
 * plausible iPad network and server-side validation windows.
 *
 * This test pins the corrected contract:
 *  - Photos with `temp-*` parent (whose parent record exists locally,
 *    i.e. they are NOT orphans) are SKIPPED without state mutation.
 *  - `retryCount` stays at 0 even after many sync cycles.
 *  - The photo remains pending (visible in `getUnuploadedPhotos`).
 *
 * True orphans (parent deleted locally) are still filtered out upstream
 * by `getUnuploadedPhotos`'s orphan check — they never reach the skip
 * branch at all, so this fix does not affect orphan handling.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Supabase client so syncPhotos never attempts real network
// calls during this unit test. The temp-parent skip path returns
// BEFORE supabase is touched, so the mocks just need to exist — they
// won't be invoked when the fix is working correctly. We assert that
// at the end.
const storageUploadMock = vi.fn();
const fromMock = vi.fn();
const storageFromMock = vi.fn(() => ({ upload: storageUploadMock }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: { from: storageFromMock },
    from: fromMock,
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: { id: 'user-luke' } }, error: null }),
      ),
      getSession: vi.fn(() =>
        Promise.resolve({
          data: {
            session: {
              user: { id: 'user-luke' },
              access_token: 't',
              refresh_token: 'r',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            },
          },
          error: null,
        }),
      ),
    },
  },
}));

// Mock cached-auth so getUserWithCache returns the fixture user without
// touching the real session-restore code path.
vi.mock('@/lib/cached-auth', () => ({
  getUserWithCache: vi.fn(() => Promise.resolve({ id: 'user-luke' })),
  getOfflineUserId: vi.fn(() => 'user-luke'),
}));

// Mock the storage-rls-probe trigger so it doesn't spawn background work
// during the test.
vi.mock('@/lib/storage-rls-probe', () => ({
  triggerProbeOnPhotoFailure: vi.fn(),
}));

// Mock the notification center so addSyncNotification doesn't try to
// touch a real notification store.
vi.mock('@/lib/notification-center', () => ({
  addSyncNotification: vi.fn(),
}));

describe('syncPhotos — temp-parent skip does NOT bump retryCount', () => {
  beforeEach(async () => {
    const req = indexedDB.deleteDatabase('rope-works-inspections');
    await new Promise<void>((resolve) => {
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    storageUploadMock.mockReset();
    fromMock.mockReset();
    storageFromMock.mockClear();
  });

  it('photo with temp-* parent (parent present locally) stays at retryCount=0 across many cycles', async () => {
    const offlineStorage = await import('../offline-storage');
    const { syncPhotos } = await import('../sync-manager');

    // Seed a temp-* parent inspection locally so the orphan filter in
    // getUnuploadedPhotos does NOT exclude the photo.
    await offlineStorage.saveInspectionOffline({
      id: 'temp-insp-1',
      location: 'Test Location',
      organization: 'Test Org',
      inspector_id: 'user-luke',
      updated_at: new Date().toISOString(),
    });

    // Seed a photo bound to that temp-* parent.
    const blob = new Blob(['fake-image-bytes'], { type: 'image/jpeg' });
    await offlineStorage.savePhotoOffline({
      id: 'photo-temp-parent-1',
      inspectionId: 'temp-insp-1',
      section: 'systems',
      blob,
      fileName: 'photo.jpg',
      uploaded: false,
      capturedByUserId: 'user-luke',
    });

    // Simulate 10 sync cycles — far more than MAX_PHOTO_RETRIES (5).
    for (let i = 0; i < 10; i++) {
      const result = await syncPhotos();
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    }

    // The photo should still exist in IDB with retryCount = 0 (the fix).
    // Read it directly via the photo store so we see the persisted state,
    // not the filtered-via-getUnuploadedPhotos view.
    const db = await offlineStorage.getDB();
    const photoAfter = await db.get('photos', 'photo-temp-parent-1');
    expect(photoAfter).toBeDefined();
    expect(photoAfter?.retryCount ?? 0).toBe(0);
    expect(photoAfter?.uploaded).toBe(0);
    expect(photoAfter?.blob).toBeDefined();

    // Supabase storage.upload should never have been called — the temp-
    // parent skip is supposed to short-circuit BEFORE any network IO.
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it('photo with temp-* parent stays visible in getUnuploadedPhotos pending count', async () => {
    const offlineStorage = await import('../offline-storage');
    const { syncPhotos } = await import('../sync-manager');

    await offlineStorage.saveInspectionOffline({
      id: 'temp-insp-2',
      location: 'L2',
      organization: 'O2',
      inspector_id: 'user-luke',
      updated_at: new Date().toISOString(),
    });

    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await offlineStorage.savePhotoOffline({
      id: 'photo-temp-parent-2',
      inspectionId: 'temp-insp-2',
      section: 'equipment',
      blob,
      fileName: 'p2.jpg',
      uploaded: false,
      capturedByUserId: 'user-luke',
    });

    // Before any sync, photo is pending.
    const beforeResult = await offlineStorage.getUnuploadedPhotos();
    const before = offlineStorage.isIdbReadFailure(beforeResult) ? [] : beforeResult;
    expect(before.map(p => p.id)).toContain('photo-temp-parent-2');

    // Run a few cycles.
    await syncPhotos();
    await syncPhotos();
    await syncPhotos();

    // After several cycles, photo is STILL pending (parent still temp-, no
    // retryCount bumps to push it into dead-letter, no nextRetryAt window
    // to make it temporarily invisible).
    const afterResult = await offlineStorage.getUnuploadedPhotos();
    const after = offlineStorage.isIdbReadFailure(afterResult) ? [] : afterResult;
    expect(after.map(p => p.id)).toContain('photo-temp-parent-2');
  });

  it('orphan photos (parent missing locally) are filtered out by getUnuploadedPhotos and never reach the skip branch', async () => {
    const offlineStorage = await import('../offline-storage');
    const { syncPhotos } = await import('../sync-manager');

    // Save a photo with temp-* parent but DO NOT save the parent.
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await offlineStorage.savePhotoOffline({
      id: 'photo-orphan',
      inspectionId: 'temp-orphan-missing',
      section: 'systems',
      blob,
      fileName: 'orphan.jpg',
      uploaded: false,
      capturedByUserId: 'user-luke',
    });

    // getUnuploadedPhotos should exclude the orphan when called with a
    // userId — the temp-orphan + UUID-orphan parent-walk is gated behind
    // `userId` (S43) so unscoped/diagnostic callers still see all rows.
    // Production callers (useUnsyncedPhotos, sync-manager) always pass
    // the resolved user id, so this matches real behaviour.
    const result = await offlineStorage.getUnuploadedPhotos('user-luke');
    const list = offlineStorage.isIdbReadFailure(result) ? [] : result;
    expect(list.map(p => p.id)).not.toContain('photo-orphan');

    // syncPhotos sees nothing to do — never invokes storage.upload.
    await syncPhotos();
    expect(storageUploadMock).not.toHaveBeenCalled();
  });
});
