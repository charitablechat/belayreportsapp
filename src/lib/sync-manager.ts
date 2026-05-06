import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { 
  getUnuploadedPhotos,
  markPhotoAsUploaded,
  incrementPhotoRetryCount,
  setPhotoLastError,
  markPhotoTransientFailure,
  updatePhotoPath,
  recordPhotoUploadFailure,
  MAX_PHOTO_RETRIES,
} from "./offline-storage";
import { addSyncNotification } from "./notification-center";
import { syncLog } from "./sync-logger";
import { extractFileExt } from "./file-ext";

/**
 * S22: Classify a photo upload / DB error into a sync-policy bucket.
 *  - 'transient'           — retry after L5 jittered backoff window, do NOT bump retryCount
 *  - 'permanent'           — bump retryCount + stamp lastError + L5 backoff
 *  - 'success-equivalent'  — already-applied (duplicate); treat as success
 */
export type PhotoErrorClass = 'transient' | 'permanent' | 'success-equivalent';

interface ErrorLike {
  status?: number | string;
  statusCode?: number | string;
  httpStatus?: number | string;
  code?: string;
  name?: string;
  message?: string;
}

export function classifyPhotoError(err: unknown): { kind: PhotoErrorClass; message: string } {
  const e: ErrorLike = (err && typeof err === 'object' ? err : {}) as ErrorLike;
  // Numeric-ish status / statusCode from Supabase StorageError / PostgrestError
  const statusRaw = e.status ?? e.statusCode ?? e.httpStatus ?? null;
  const status = typeof statusRaw === 'string' ? parseInt(statusRaw, 10) : statusRaw;
  const code: string | undefined = typeof e.code === 'string' ? e.code : undefined;
  const name: string | undefined = typeof e.name === 'string' ? e.name : undefined;
  const rawMsg: string = typeof e.message === 'string' ? e.message : String(err ?? 'Unknown error');
  const msg = rawMsg.toLowerCase();

  // Postgres unique violation — already covered upstream as success.
  if (code === '23505' || msg.includes('duplicate key')) {
    return { kind: 'success-equivalent', message: rawMsg };
  }
  // Storage "duplicate" with upsert — treat as success.
  if (status === 409 && (msg.includes('duplicate') || msg.includes('already exists'))) {
    return { kind: 'success-equivalent', message: rawMsg };
  }

  // Transient: network / abort / 5xx / 429 / generic 409 conflict / fetch failed.
  if (
    name === 'AbortError' ||
    name === 'TypeError' && msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 409 ||
    (typeof status === 'number' && status >= 500 && status < 600)
  ) {
    return { kind: 'transient', message: rawMsg };
  }

  // Everything else (400/401/403/404/413/415/422, RLS, bucket missing, invalid key…)
  return { kind: 'permanent', message: rawMsg };
}


// Photo sync manager - still valid, not deprecated
import { runWithConcurrency } from './concurrency';
import { isMobile } from './mobile-detection';
import { triggerProbeOnPhotoFailure } from './storage-rls-probe';

// S7: Raised from 10 → 30. Photo upload is bounded-parallel (3 mobile / 5 desktop)
// and Storage handles concurrent PUTs fine; the previous 10/cycle made backlogs of
// 200+ photos take 20+ sync cycles to drain.
const MAX_PHOTO_BATCH_SIZE = 30;

/**
 * 1.C — Centralized "permanent failure" handler. Stamps lastError, bumps the
 * retry counter, and when the photo crosses the dead-letter threshold persists
 * a record to `photo_upload_failures` so it can be surfaced to the user/admin
 * instead of becoming a silent orphan. Returns the new retry count, and a
 * boolean indicating whether the photo just crossed the threshold (caller
 * uses this to decide whether to emit a sync-center notification once per
 * cycle).
 */
/**
 * Minimal photo shape needed for the dead-letter flow. Mirrors a subset of
 * the `photos` object-store record in `offline-storage.ts` without coupling
 * this module to the full DB schema.
 */
interface PhotoForFailure {
  id: string;
  inspectionId?: string;
  section?: string;
  fileName?: string;
  photoUrl?: string;
  timestamp?: number;
  retryCount?: number;
  capturedByUserId?: string | null;
}

async function handlePermanentPhotoFailure(
  photo: PhotoForFailure,
  message: string
): Promise<{ retryCount: number; crossedThreshold: boolean }> {
  await setPhotoLastError(photo.id, message);
  const retryCount = await incrementPhotoRetryCount(photo.id);
  const crossedThreshold = retryCount >= MAX_PHOTO_RETRIES;
  if (crossedThreshold) {
    try {
      await recordPhotoUploadFailure({
        id: photo.id,
        inspectionId: photo.inspectionId,
        fileName: photo.fileName,
        photoUrl: photo.photoUrl,
        section: photo.section,
        retryCount,
        lastError: message,
        lastErrorAt: Date.now(),
        capturedByUserId: photo.capturedByUserId ?? null,
      });
    } catch (e) {
      console.warn('[Sync Manager] Failed to persist photo upload failure:', e);
    }
  }
  return { retryCount, crossedThreshold };
}

export async function syncPhotos(signal?: AbortSignal): Promise<{ remaining: number; changed?: number; error?: string }> {
  if (signal?.aborted) return { remaining: 0, changed: 0 };
  if (!navigator.onLine) {
    syncLog.log('[Sync Manager] Offline - skipping photo sync');
    return { remaining: 0, changed: 0 };
  }

  syncLog.log('[Sync Manager] Starting photo sync...');

  try {
    const { isIdbReadFailure } = await import('./offline-storage');
    const unuploadedPhotosResult = await getUnuploadedPhotos();
    if (isIdbReadFailure(unuploadedPhotosResult)) {
      console.warn('[Sync Manager] IDB read failure for unuploaded photos:', unuploadedPhotosResult.error);
      return { remaining: -1, changed: 0, error: unuploadedPhotosResult.error };
    }
    const unuploadedPhotos = unuploadedPhotosResult;
    // Skip photos that have exceeded retry limit
    const eligiblePhotos = unuploadedPhotos.filter(p => (p.retryCount || 0) < MAX_PHOTO_RETRIES);
    const skippedCount = unuploadedPhotos.length - eligiblePhotos.length;
    const batch = eligiblePhotos.slice(0, MAX_PHOTO_BATCH_SIZE);
    const remaining = Math.max(0, eligiblePhotos.length - MAX_PHOTO_BATCH_SIZE);
    
    if (skippedCount > 0) {
      syncLog.warn(`[Sync Manager] Skipping ${skippedCount} photos that exceeded ${MAX_PHOTO_RETRIES} retries`);
    }

    syncLog.log(`[Sync Manager] Uploading photos: ${batch.length} of ${eligiblePhotos.length} (${remaining} remaining)`);

    let successCount = 0;
    // S34: Count any state-changing photo outcome (success or dead-letter
    // bump) so the per-cycle dispatch in useAutoSync can stay quiet on
    // truly idle cycles.
    let changedCount = 0;
    // 1.C — Per-cycle count of photos that JUST crossed the dead-letter
    // threshold this cycle. Drives a single user-facing notification at end
    // of cycle (instead of one per photo).
    let newlyDeadLettered = 0;
    // Track IDs already processed in this batch to skip duplicates without N+1 queries.
    // Read-then-await pattern below makes this safe under bounded concurrency.
    const processedIds = new Set<string>();

    // S3: Bounded parallel uploads — Storage handles concurrent PUTs fine.
    // 3 on mobile / 5 on desktop keeps us within network/connection-pool comfort zone.
    const photoConcurrency = isMobile() ? 3 : 5;

    await runWithConcurrency(batch, photoConcurrency, async (photo) => {
      if (signal?.aborted) return;
      try {
        if (processedIds.has(photo.id)) {
          successCount++;
          return;
        }

        if (photo.inspectionId?.startsWith('temp-')) {
          syncLog.warn('[Sync Manager] Skipping photo with temporary inspection ID:', photo.id);
          // S13: Count temp-parent skips toward retry ceiling so chronically
          // stuck photos eventually surface in the dead-letter UI instead of
          // being silently invisible. Age-based GC (evictStuckTempPhotos)
          // handles the long-tail cleanup.
          await incrementPhotoRetryCount(photo.id);
          changedCount++;
          return;
        }

        // S23: Bind photo to its capturing user. Resolve current user once.
        const currentUser = await getUserWithCache();
        const currentUserId = currentUser?.id || null;
        const capturedBy = (photo as { capturedByUserId?: string | null }).capturedByUserId ?? undefined;

        // Cross-user guard: if the photo was captured by a different user than
        // is currently signed in, do NOT rewrite the path under the new user.
        if (capturedBy && currentUserId && capturedBy !== currentUserId) {
          const ageMs = Date.now() - (photo.timestamp || Date.now());
          const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
          if (ageMs > SEVEN_DAYS) {
            // Surface to dead-letter UI via S22 plumbing.
            console.warn('[Sync Manager] Photo belongs to a different signed-in user (>7d old) — dead-lettering:', photo.id);
            const r = await handlePermanentPhotoFailure(photo, 'Photo belongs to a different signed-in user');
            if (r.crossedThreshold) newlyDeadLettered++;
            changedCount++;
          } else {
            syncLog.log('[Sync Manager] Skipping photo captured by different user:', photo.id, 'capturedBy=', capturedBy, 'currentUser=', currentUserId);
          }
          return;
        }

        // Inspection-ownership cross-check: if the parent inspection is owned
        // by a different user than the one who staged the photo, dead-letter it.
        if (capturedBy && photo.inspectionId && !photo.inspectionId.startsWith('temp-')) {
          try {
            const { getOfflineInspection, getOfflineDailyAssessment } = await import('./offline-storage');
            const parent = (await getOfflineInspection(photo.inspectionId)) || (await getOfflineDailyAssessment(photo.inspectionId));
            const parentOwnerId = parent?.inspector_id || parent?.user_id || null;
            if (parentOwnerId && parentOwnerId !== capturedBy) {
              console.warn('[Sync Manager] Photo capturer does not match inspection owner — dead-lettering:', photo.id);
              const r = await handlePermanentPhotoFailure(photo, 'Photo belongs to a different signed-in user');
              if (r.crossedThreshold) newlyDeadLettered++;
              changedCount++;
              return;
            }
          } catch {
            // Best-effort cross-check; don't block sync on lookup failure.
          }
        }

        // C6: Legacy `pending/` rewrite — refuse to attribute untagged photos
        // to whoever is currently signed in. On shared devices (one iPad
        // passed between inspectors) blind rewriting silently mis-attributes
        // safety-inspection photos to the wrong inspector.
        //
        // Rules:
        //   1. If the photo carries a `capturedBy` tag, use that.
        //   2. If untagged, fall back to the parent inspection's owner
        //      (`inspector_id` / `user_id`) — that's the authoritative
        //      attribution for any photo belonging to that report.
        //   3. If neither is known (orphan or offline-only parent without an
        //      owner field), dead-letter immediately and surface in Sync
        //      Diagnostics so the device owner can resolve manually instead
        //      of letting the code guess.
        //   4. Storage RLS still requires the upload prefix == auth.uid().
        //      So if the resolved attribution !== current user, dead-letter
        //      (the photo will sync correctly when the right user signs in).
        if (photo.photoUrl?.startsWith('pending/')) {
          if (!currentUserId) {
            syncLog.log('[Sync Manager] Skipping pending photo (no auth):', photo.id);
            return;
          }
          if (capturedBy && capturedBy !== currentUserId) {
            // Already handled above, but defense in depth.
            return;
          }

          // Resolve the authoritative attribution: capturedBy -> parent owner.
          let parentOwnerId: string | null = null;
          try {
            const { getOfflineInspection, getOfflineDailyAssessment } = await import('./offline-storage');
            const parent = (await getOfflineInspection(photo.inspectionId)) || (await getOfflineDailyAssessment(photo.inspectionId));
            parentOwnerId = parent?.inspector_id || parent?.user_id || null;
          } catch {
            parentOwnerId = null;
          }

          const attributionUserId = capturedBy || parentOwnerId;

          // Rule 3: untagged + no parent owner -> refuse to guess.
          if (!attributionUserId) {
            console.warn('[Sync Manager] Legacy pending photo has no attribution (no capturedBy and no parent owner) — dead-lettering:', photo.id);
            const r = await handlePermanentPhotoFailure(
              photo,
              'Photo has no attribution — original capturer unknown. Open Sync Diagnostics to resolve.'
            );
            if (r.crossedThreshold) newlyDeadLettered++;
            changedCount++;
            return;
          }

          // Rule 4: attribution !== current user -> dead-letter rather than
          // upload under the wrong inspector's folder.
          if (attributionUserId !== currentUserId) {
            console.warn('[Sync Manager] Legacy pending photo belongs to a different user — dead-lettering:', photo.id, 'attributedTo=', attributionUserId, 'currentUser=', currentUserId);
            const r = await handlePermanentPhotoFailure(photo, 'Photo belongs to a different signed-in user');
            if (r.crossedThreshold) newlyDeadLettered++;
            changedCount++;
            return;
          }

          // Safe to rewrite: attribution == current user.
          const normalizedPath = photo.photoUrl.replace(/^pending\//, `${attributionUserId}/`);
          photo.photoUrl = normalizedPath;
          try {
            const { updatePhotoUrl, setPhotoCapturedBy } = await import('./offline-storage');
            await updatePhotoUrl(photo.id, normalizedPath);
            // Stamp capturedBy now that we've definitively bound it (using
            // the resolved attribution, not blindly currentUserId).
            await setPhotoCapturedBy(photo.id, attributionUserId);
          } catch (e) {
            console.warn('[Sync Manager] Failed to persist normalized path:', e);
          }
          syncLog.log('[Sync Manager] Normalized legacy pending path to:', normalizedPath, '(attributed to parent owner)');
        }

        // Guard: blob must exist (may have been nullified by a previous partial success)
        if (!photo.blob) {
          if (photo.photoUrl && !photo.photoUrl.startsWith('pending/')) {
            // C5: Real, non-pending storage path is on record — the previous upload
            // succeeded and only the markPhotoAsUploaded write lost its way.
            // Safe to finalize with the known-good path.
            syncLog.warn('[Sync Manager] Finalizing photo with null blob but known photoUrl:', photo.id);
            await markPhotoAsUploaded(photo.id, photo.photoUrl);
            changedCount++;
            return;
          }

          // C5: No blob AND no trustworthy photoUrl — we cannot reconstruct the upload.
          // Surface as a permanent dead-letter so the user sees it in
          // SyncDiagnosticsSheet instead of a silent broken-image landmine in the
          // rendered report. Never fall back to photo.id (it is not a valid storage key).
          console.error('[Sync Manager] Photo has no blob and no photoUrl — dead-lettering:', photo.id);
          await setPhotoLastError(photo.id, 'Photo data missing (no blob and no storage path). Re-capture required.');
          // Saturate the retry counter so the dead-letter UI surfaces it on next refresh
          // (the photo is not recoverable by retry).
          for (let i = 0; i < MAX_PHOTO_RETRIES; i++) {
            await incrementPhotoRetryCount(photo.id);
          }
          // 1.C — Persist to dead-letter store immediately (saturating
          // retryCount is a permanent state, not a transient one).
          try {
            await recordPhotoUploadFailure({
              id: photo.id,
              inspectionId: photo.inspectionId,
              fileName: photo.fileName,
              photoUrl: photo.photoUrl,
              section: photo.section,
              retryCount: MAX_PHOTO_RETRIES,
              lastError: 'Photo data missing (no blob and no storage path). Re-capture required.',
              lastErrorAt: Date.now(),
              capturedByUserId: photo.capturedByUserId ?? null,
            });
            newlyDeadLettered++;
          } catch (e) {
            console.warn('[Sync Manager] Failed to persist no-blob failure:', e);
          }
          changedCount++;
          return;
        }

        let user: { id: string } | null = await getUserWithCache();
        if (!user) {
          const { getOfflineUserId } = await import('./cached-auth');
          const offlineId = getOfflineUserId();
          if (offlineId) user = { id: offlineId };
        }
        if (!user) throw new Error("Not authenticated");

        // Use per-photo metadata with backward-compatible defaults
        const bucket = photo.storageBucket || 'inspection-photos';
        const table = photo.tableName || 'inspection_photos';
        const fkColumn = photo.foreignKeyColumn || 'inspection_id';

        const fileExt = extractFileExt(photo.fileName);
        // M7: Include a short random suffix to make filenames collision-resistant
        // even when two devices share Date.now() (clock skew on offline restore).
        // Combined with upsert: false below, this prevents one device's blob from
        // silently overwriting another's at the storage layer.
        const randomSuffix = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
        const fallbackFileName = `${user.id}/${photo.inspectionId}/${Date.now()}-${randomSuffix}.${fileExt}`;
        let fileName = photo.photoUrl || fallbackFileName;

        // 1.B — Defensive re-key at upload time (belt-and-braces). If the
        // first path segment doesn't match the currently authenticated uid
        // (e.g. a queued offline photo whose deterministic-uid prefix wasn't
        // rewritten by 1.A reconciliation, or a cross-account edge case),
        // rewrite to the real auth.uid() folder so the upload passes storage
        // RLS. Persist the rewrite so subsequent SELECT/sync uses the new
        // path. Skip rewrite if the photo was captured by a *different*
        // signed-in user (already filtered above), or if `user.id` is empty.
        try {
          const pathParts = fileName.split('/');
          if (
            user.id &&
            pathParts.length > 1 &&
            pathParts[0] !== user.id &&
            pathParts[0] !== 'pending' // legacy pending/ rewrite is handled earlier
          ) {
            const oldFileName = fileName;
            pathParts[0] = user.id;
            const rekeyed = pathParts.join('/');
            console.warn('[Sync Manager] Rekeying photo path', oldFileName, '→', rekeyed);
            fileName = rekeyed;
            photo.photoUrl = rekeyed;
            try {
              await updatePhotoPath(photo.id, rekeyed);
            } catch (e) {
              console.warn('[Sync Manager] Failed to persist re-keyed photo path:', e);
            }
          }
        } catch (e) {
          // Re-key is best-effort; a parsing edge case shouldn't block upload.
          console.warn('[Sync Manager] Re-key check failed (continuing):', e);
        }

        // Upload to storage. M7: upsert: false — refuse silent overwrites.
        // The existing `classifyPhotoError` ("success-equivalent" branch) treats
        // a duplicate-object 409 as success and proceeds to the DB insert path,
        // which is correct on retry of an already-uploaded photo.
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(fileName, photo.blob, {
            contentType: photo.blob.type || 'image/jpeg',
            upsert: false,
          });

        if (uploadError) {
          // S22: Classify upload errors instead of treating all as permanent.
          const cls = classifyPhotoError(uploadError);
          // M3: An RLS-shaped denial is signal that the policy may have
          // regressed mid-day. Re-run the storage probe immediately (rate-
          // limited, debounced) to confirm "policy regression" vs
          // "transient per-photo error". Fire-and-forget — never blocks the
          // sync cycle.
          triggerProbeOnPhotoFailure(uploadError);
          syncLog.log(`[Sync Manager] Upload error classified as ${cls.kind} for ${photo.id}:`, cls.message);
          if (cls.kind === 'success-equivalent') {
            // Storage already has the object — proceed to DB insert path.
          } else if (cls.kind === 'transient') {
            console.warn('[Sync Manager] Transient upload error, will retry after backoff:', photo.id, cls.message);
            // L5: Stamp lastError + nextRetryAt (jittered) so the photo
            // backs off on subsequent cycles instead of being eligible
            // immediately. retryCount is intentionally NOT bumped — a
            // transient flake should never push a photo toward dead-letter.
            await markPhotoTransientFailure(photo.id, cls.message);
            return;
          } else {
            // permanent
            console.error('[Sync Manager] Permanent upload error for photo:', photo.id, cls.message);
            const r = await handlePermanentPhotoFailure(photo, cls.message);
            if (r.crossedThreshold) newlyDeadLettered++;
            changedCount++;
            return;
          }
        }

        // Deduplication guard: check if a DB row already exists for this photo_url
        const { data: existing } = await (supabase.from(
          table as never,
        ) as unknown as {
          select: (c: string) => {
            eq: (col: string, val: string) => {
              eq: (col: string, val: string) => {
                maybeSingle: () => Promise<{ data: { id: string } | null }>;
              };
            };
          };
        })
          .select('id')
          .eq('photo_url', fileName)
          .eq(fkColumn, photo.inspectionId)
          .maybeSingle();

        if (!existing) {
          // Resolve a caption: prefer the queued caption, but if it is empty
          // or a generic placeholder, look up the parent item's current name
          // (covers photos captured before the user typed a name, or rows
          // renamed after capture but before sync).
          let caption: string = (photo.caption || '').trim();
          const generic = !caption
            || caption === 'Item photo'
            || caption === 'Photo'
            || caption === photo.section
            || caption === (photo.section || '').replace(/-/g, ' ');
          if (generic) {
            const itemMatch = (photo.photoUrl || '').match(/\/items\/([0-9a-f-]{36})\./i);
            const itemId = itemMatch?.[1];
            if (itemId) {
              try {
                if (photo.section === 'systems') {
                  const { data: sys } = await supabase
                    .from('inspection_systems')
                    .select('name, system_name')
                    .eq('id', itemId)
                    .maybeSingle();
                  const sysName = (sys?.name || sys?.system_name || '').trim();
                  if (sysName) caption = sysName;
                  if (!caption) {
                    const { data: zip } = await supabase
                      .from('inspection_ziplines')
                      .select('zipline_name')
                      .eq('id', itemId)
                      .maybeSingle();
                    if (zip?.zipline_name) caption = zip.zipline_name.trim();
                  }
                } else if (photo.section === 'equipment') {
                  const { data: eq } = await supabase
                    .from('inspection_equipment')
                    .select('equipment_type')
                    .eq('id', itemId)
                    .maybeSingle();
                  if (eq?.equipment_type) caption = eq.equipment_type.trim();
                }
              } catch { /* non-critical, fall back to generic */ }
            }
          }
          if (!caption) caption = photo.section || 'Photo';

          // Save to database with file path (signed URLs generated on read)
          const { error: dbError } = await (supabase.from(
            table as never,
          ) as unknown as {
            insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
          })
            .insert({
              [fkColumn]: photo.inspectionId,
              photo_url: fileName,
              photo_section: photo.section,
              caption,
            });

          if (dbError) {
            // S22: Classify DB errors. 23505 / duplicate already maps to
            // success-equivalent in classifyPhotoError.
            const cls = classifyPhotoError(dbError);
            syncLog.log(`[Sync Manager] DB insert error classified as ${cls.kind} for ${photo.id}:`, cls.message);
            if (cls.kind === 'success-equivalent') {
              syncLog.log('[Sync Manager] Unique constraint hit (race OK), treating as success:', photo.id);
            } else if (cls.kind === 'transient') {
              console.warn('[Sync Manager] Transient DB insert error, will retry after backoff:', photo.id, cls.message);
              // L5: see upload-error path above.
              await markPhotoTransientFailure(photo.id, cls.message);
              return;
            } else {
              console.error('[Sync Manager] Permanent DB insert error for photo:', photo.id, cls.message);
              const r = await handlePermanentPhotoFailure(photo, cls.message);
              if (r.crossedThreshold) newlyDeadLettered++;
              changedCount++;
              return;
            }
          }
        } else {
          syncLog.log('[Sync Manager] Skipped duplicate DB row for photo:', photo.id);
        }

        // Mark as uploaded and release blob from IndexedDB (also clears lastError)
        await markPhotoAsUploaded(photo.id, fileName);
        processedIds.add(photo.id);
        successCount++;
        changedCount++;

        syncLog.log('[Sync Manager] Uploaded photo:', photo.id);
      } catch (error) {
        // S22: Unexpected throws (e.g. auth/network exceptions outside the
        // explicit error checks). Classify before bumping retryCount.
        const cls = classifyPhotoError(error);
        console.error(`[Sync Manager] Failed to upload photo (${cls.kind}):`, photo.id, cls.message);
        if (cls.kind === 'transient') {
          // L5: Stamp lastError + nextRetryAt (jittered) so this catch-all
          // path also backs off instead of being immediately eligible —
          // mirrors the explicit upload + DB-insert transient paths above.
          // retryCount is intentionally NOT bumped.
          await markPhotoTransientFailure(photo.id, cls.message);
          return;
        }
        const r = await handlePermanentPhotoFailure(photo, cls.message);
        if (r.crossedThreshold) newlyDeadLettered++;
        changedCount++;
      }
    });

    syncLog.log(`[Sync Manager] Photo sync completed: ${successCount} photos, ${remaining} remaining (changed=${changedCount}, newlyDeadLettered=${newlyDeadLettered})`);

    // 1.C — Surface dead-letter crossings to the in-app notification center
    // so the user sees they have stuck photos to review (one notification per
    // cycle, not per photo).
    if (newlyDeadLettered > 0) {
      const word = newlyDeadLettered === 1 ? 'photo' : 'photos';
      addSyncNotification(
        `${newlyDeadLettered} ${word} failed to upload and may be lost — open Sync Diagnostics to review.`
      );
    }

    return { remaining, changed: changedCount };
  } catch (error) {
    console.error('[Sync Manager] Photo sync error:', error);
    return { remaining: 0, changed: 0 };
  }
}

// NOTE: The duplicate "online" listener that was here has been removed (P1).
// All sync orchestration (including photo sync) is handled by useAutoSync.tsx
// which provides proper guards: cooldown, batch limits, syncInProgressRef.
