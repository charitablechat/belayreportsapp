import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * L5 — Jittered backoff for photo retries.
 *
 * Pins the contract that:
 *  1) `jitteredPhotoBackoffMs(attempt)` returns a positive number that grows
 *     with attempt and caps at 300s.
 *  2) `markPhotoTransientFailure` stamps `lastError`, `lastErrorAt`, and
 *     `nextRetryAt` WITHOUT bumping `retryCount`.
 *  3) `incrementPhotoRetryCount` stamps `nextRetryAt` after bumping count.
 *  4) `markPhotoAsUploaded` clears `nextRetryAt` (success unblocks future).
 *  5) `resetPhotoForRetry` clears `nextRetryAt` (manual retry unblocks).
 *  6) `getUnuploadedPhotos` skips photos with `nextRetryAt > now` and
 *     returns them once the window has elapsed.
 */

describe('L5 jittered photo backoff', () => {
  beforeEach(async () => {
    const req = indexedDB.deleteDatabase('rope-works-inspections');
    await new Promise<void>((resolve) => {
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    vi.useRealTimers();
  });

  it('jitteredPhotoBackoffMs grows with attempt and caps at 300s', async () => {
    const { jitteredPhotoBackoffMs } = await import('../sync-quarantine');

    const samples = (n: number) =>
      Array.from({ length: 50 }, () => jitteredPhotoBackoffMs(n));

    const a1 = samples(1);
    const a2 = samples(2);
    const a3 = samples(3);
    const a5 = samples(5);
    const a10 = samples(10);

    // attempt 1 ~5s ±20% → [4000, 6000]
    expect(Math.min(...a1)).toBeGreaterThanOrEqual(4000);
    expect(Math.max(...a1)).toBeLessThanOrEqual(6000);

    // attempt 2 ~15s ±20% → [12000, 18000]
    expect(Math.min(...a2)).toBeGreaterThanOrEqual(12000);
    expect(Math.max(...a2)).toBeLessThanOrEqual(18000);

    // attempt 3 ~45s ±20% → [36000, 54000]
    expect(Math.min(...a3)).toBeGreaterThanOrEqual(36000);
    expect(Math.max(...a3)).toBeLessThanOrEqual(54000);

    // attempt 5 hits the 300s cap → [240000, 360000]; cap clips to 300000
    // base before jitter is min(5000 * 3^4, 300000) = min(405000, 300000) = 300000
    // so window is [240000, 360000].
    expect(Math.min(...a5)).toBeGreaterThanOrEqual(240000);
    expect(Math.max(...a5)).toBeLessThanOrEqual(360000);

    // attempt 10 also caps at 300s ±20%
    expect(Math.min(...a10)).toBeGreaterThanOrEqual(240000);
    expect(Math.max(...a10)).toBeLessThanOrEqual(360000);
  });

  it('jitteredPhotoBackoffMs floors at 1000ms even with full negative jitter', async () => {
    const { jitteredPhotoBackoffMs } = await import('../sync-quarantine');
    // 200 samples — at attempt 1 the floor catches anything < 4000ms (none
    // in the formula, but the explicit Math.max(1000, …) clamp guarantees
    // the function never returns < 1s regardless of attempt).
    for (let i = 0; i < 200; i++) {
      expect(jitteredPhotoBackoffMs(0)).toBeGreaterThanOrEqual(1000);
    }
  });

  it('markPhotoTransientFailure stamps lastError + nextRetryAt without bumping retryCount', async () => {
    const mod = await import('../offline-storage');
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await mod.savePhotoOffline({
      id: 'p-trans',
      inspectionId: 'insp-1',
      section: 'systems',
      blob,
      fileName: 'a.jpg',
      uploaded: false,
    });

    const before = Date.now();
    await mod.markPhotoTransientFailure('p-trans', 'Network blip');
    const after = Date.now();

    const all = (await mod.getUnuploadedPhotos()) as Array<{
      id: string;
      retryCount?: number;
      lastError?: string | null;
      lastErrorAt?: number | null;
      nextRetryAt?: number | null;
    }>;
    // The photo is now inside its backoff window so getUnuploadedPhotos
    // should NOT return it. Read directly to assert state.
    expect(all.find(p => p.id === 'p-trans')).toBeUndefined();

    // Re-read raw via a getAll-equivalent
    const { getAllPhotosForTesting } = mod as unknown as {
      getAllPhotosForTesting?: () => Promise<unknown[]>;
    };
    if (!getAllPhotosForTesting) {
      // Fall back to reading via openDB directly
      const idbMod = await import('idb');
      const db = await idbMod.openDB('rope-works-inspections');
      const photo = await db.get('photos', 'p-trans') as {
        retryCount?: number;
        lastError?: string;
        lastErrorAt?: number;
        nextRetryAt?: number;
      };
      db.close();
      expect(photo.retryCount ?? 0).toBe(0);
      expect(photo.lastError).toBe('Network blip');
      expect(photo.lastErrorAt).toBeGreaterThanOrEqual(before);
      expect(photo.lastErrorAt).toBeLessThanOrEqual(after);
      expect(photo.nextRetryAt).toBeGreaterThan(after);
      // attempt 1 ~5s
      expect(photo.nextRetryAt! - (photo.lastErrorAt ?? 0)).toBeGreaterThanOrEqual(4000);
      expect(photo.nextRetryAt! - (photo.lastErrorAt ?? 0)).toBeLessThanOrEqual(6000);
    }
  });

  it('getUnuploadedPhotos skips photos in their backoff window and returns them once it expires', async () => {
    const mod = await import('../offline-storage');
    const blob = new Blob(['y'], { type: 'image/jpeg' });
    await mod.savePhotoOffline({
      id: 'p-window',
      inspectionId: 'insp-window',
      section: 'systems',
      blob,
      fileName: 'b.jpg',
      uploaded: false,
    });

    // Initial: never failed → returned
    let out = (await mod.getUnuploadedPhotos()) as Array<{ id: string }>;
    expect(out.find(p => p.id === 'p-window')).toBeDefined();

    // Stamp a transient failure → photo enters ~5s backoff window
    await mod.markPhotoTransientFailure('p-window', 'flake');
    out = (await mod.getUnuploadedPhotos()) as Array<{ id: string }>;
    expect(out.find(p => p.id === 'p-window')).toBeUndefined();

    // Force-clear nextRetryAt by reading the row, mutating, writing back
    // (simulates the window expiring without having to wait wall-clock).
    const idbMod = await import('idb');
    const db = await idbMod.openDB('rope-works-inspections');
    const photo = await db.get('photos', 'p-window') as { nextRetryAt: number | null };
    photo.nextRetryAt = Date.now() - 1000; // 1 second ago
    await db.put('photos', photo as never);
    db.close();

    out = (await mod.getUnuploadedPhotos()) as Array<{ id: string }>;
    expect(out.find(p => p.id === 'p-window')).toBeDefined();
  });

  it('incrementPhotoRetryCount stamps nextRetryAt with the post-bump count', async () => {
    const mod = await import('../offline-storage');
    const blob = new Blob(['z'], { type: 'image/jpeg' });
    await mod.savePhotoOffline({
      id: 'p-perm',
      inspectionId: 'insp-perm',
      section: 'systems',
      blob,
      fileName: 'c.jpg',
      uploaded: false,
    });

    const newCount = await mod.incrementPhotoRetryCount('p-perm');
    expect(newCount).toBe(1);

    const idbMod = await import('idb');
    const db = await idbMod.openDB('rope-works-inspections');
    const photo = await db.get('photos', 'p-perm') as {
      retryCount: number;
      nextRetryAt: number;
    };
    db.close();

    expect(photo.retryCount).toBe(1);
    // attempt 1 ~5s → window of ~4-6s into the future
    const delta = photo.nextRetryAt - Date.now();
    expect(delta).toBeGreaterThanOrEqual(3000);
    expect(delta).toBeLessThanOrEqual(7000);
  });

  it('markPhotoAsUploaded clears nextRetryAt (success path unblocks future re-uploads)', async () => {
    const mod = await import('../offline-storage');
    const blob = new Blob(['w'], { type: 'image/jpeg' });
    await mod.savePhotoOffline({
      id: 'p-success',
      inspectionId: 'insp-success',
      section: 'systems',
      blob,
      fileName: 'd.jpg',
      uploaded: false,
    });

    await mod.markPhotoTransientFailure('p-success', 'transient');
    const idbMod = await import('idb');
    let db = await idbMod.openDB('rope-works-inspections');
    let photo = await db.get('photos', 'p-success') as { nextRetryAt?: number | null };
    db.close();
    expect(photo.nextRetryAt).toBeGreaterThan(Date.now());

    await mod.markPhotoAsUploaded('p-success', 'insp-success/p-success.jpg');
    db = await idbMod.openDB('rope-works-inspections');
    photo = await db.get('photos', 'p-success') as { nextRetryAt?: number | null };
    db.close();
    expect(photo.nextRetryAt).toBeNull();
  });

  it('resetPhotoForRetry clears nextRetryAt (manual retry unblocks immediately)', async () => {
    const mod = await import('../offline-storage');
    const blob = new Blob(['v'], { type: 'image/jpeg' });
    await mod.savePhotoOffline({
      id: 'p-reset',
      inspectionId: 'insp-reset',
      section: 'systems',
      blob,
      fileName: 'e.jpg',
      uploaded: false,
    });

    await mod.markPhotoTransientFailure('p-reset', 'transient');
    let out = (await mod.getUnuploadedPhotos()) as Array<{ id: string }>;
    expect(out.find(p => p.id === 'p-reset')).toBeUndefined(); // in window

    const ok = await mod.resetPhotoForRetry('p-reset');
    expect(ok).toBe(true);

    out = (await mod.getUnuploadedPhotos()) as Array<{ id: string }>;
    expect(out.find(p => p.id === 'p-reset')).toBeDefined(); // window cleared
  });

  it('savePhotoOffline of a fresh photo (no nextRetryAt) is eligible immediately', async () => {
    const mod = await import('../offline-storage');
    const blob = new Blob(['u'], { type: 'image/jpeg' });
    await mod.savePhotoOffline({
      id: 'p-fresh',
      inspectionId: 'insp-fresh',
      section: 'systems',
      blob,
      fileName: 'f.jpg',
      uploaded: false,
    });

    const out = (await mod.getUnuploadedPhotos()) as Array<{ id: string }>;
    expect(out.find(p => p.id === 'p-fresh')).toBeDefined();
  });
});
