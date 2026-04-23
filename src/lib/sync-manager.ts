import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { 
  getUnuploadedPhotos,
  markPhotoAsUploaded,
  incrementPhotoRetryCount,
  setPhotoLastError,
  MAX_PHOTO_RETRIES,
} from "./offline-storage";

/**
 * S22: Classify a photo upload / DB error into a sync-policy bucket.
 *  - 'transient'           — retry next cycle, do NOT bump retryCount
 *  - 'permanent'           — bump retryCount + stamp lastError
 *  - 'success-equivalent'  — already-applied (duplicate); treat as success
 */
export type PhotoErrorClass = 'transient' | 'permanent' | 'success-equivalent';

export function classifyPhotoError(err: unknown): { kind: PhotoErrorClass; message: string } {
  const e: any = err || {};
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


/**
 * @deprecated Use syncAllInspectionsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users
 * due to RLS policies blocking SELECT on deleted records.
 */
export async function syncInspections(): Promise<never> {
  throw new Error(
    '[Sync Manager] BLOCKED: syncInspections() is deprecated and disabled. ' +
    'Use syncAllInspectionsAtomic() from atomic-sync-manager.ts instead. ' +
    'This function bypasses atomic sync integrity safeguards.'
  );
}

/**
 * @deprecated Use syncAllDailyAssessmentsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users.
 */
export async function syncDailyAssessments(): Promise<never> {
  throw new Error(
    '[Sync Manager] BLOCKED: syncDailyAssessments() is deprecated and disabled. ' +
    'Use syncAllDailyAssessmentsAtomic() from atomic-sync-manager.ts instead. ' +
    'This function bypasses atomic sync integrity safeguards.'
  );
}

/**
 * @deprecated Use syncAllTrainingsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users.
 */
export async function syncTrainings(): Promise<never> {
  throw new Error(
    '[Sync Manager] BLOCKED: syncTrainings() is deprecated and disabled. ' +
    'Use syncAllTrainingsAtomic() from atomic-sync-manager.ts instead. ' +
    'This function bypasses atomic sync integrity safeguards.'
  );
}

// Photo sync manager - still valid, not deprecated
import { runWithConcurrency } from './concurrency';
import { isMobile } from './mobile-detection';

// S7: Raised from 10 → 30. Photo upload is bounded-parallel (3 mobile / 5 desktop)
// and Storage handles concurrent PUTs fine; the previous 10/cycle made backlogs of
// 200+ photos take 20+ sync cycles to drain.
const MAX_PHOTO_BATCH_SIZE = 30;

export async function syncPhotos(signal?: AbortSignal): Promise<{ remaining: number; changed?: number; error?: string }> {
  if (signal?.aborted) return { remaining: 0, changed: 0 };
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Offline - skipping photo sync');
    }
    return { remaining: 0, changed: 0 };
  }

  if (import.meta.env.DEV) {
    console.log('[Sync Manager] Starting photo sync...');
  }

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
    
    if (skippedCount > 0 && import.meta.env.DEV) {
      console.warn(`[Sync Manager] Skipping ${skippedCount} photos that exceeded ${MAX_PHOTO_RETRIES} retries`);
    }

    if (import.meta.env.DEV) {
      console.log(`[Sync Manager] Uploading photos: ${batch.length} of ${eligiblePhotos.length} (${remaining} remaining)`);
    }

    let successCount = 0;
    // S34: Count any state-changing photo outcome (success or dead-letter
    // bump) so the per-cycle dispatch in useAutoSync can stay quiet on
    // truly idle cycles.
    let changedCount = 0;
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
          if (import.meta.env.DEV) {
            console.warn('[Sync Manager] Skipping photo with temporary inspection ID:', photo.id);
          }
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
        const capturedBy = (photo as any).capturedByUserId as string | null | undefined;

        // Cross-user guard: if the photo was captured by a different user than
        // is currently signed in, do NOT rewrite the path under the new user.
        if (capturedBy && currentUserId && capturedBy !== currentUserId) {
          const ageMs = Date.now() - (photo.timestamp || Date.now());
          const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
          if (ageMs > SEVEN_DAYS) {
            // Surface to dead-letter UI via S22 plumbing.
            console.warn('[Sync Manager] Photo belongs to a different signed-in user (>7d old) — dead-lettering:', photo.id);
            await setPhotoLastError(photo.id, 'Photo belongs to a different signed-in user');
            await incrementPhotoRetryCount(photo.id);
            changedCount++;
          } else if (import.meta.env.DEV) {
            console.log('[Sync Manager] Skipping photo captured by different user:', photo.id, 'capturedBy=', capturedBy, 'currentUser=', currentUserId);
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
              await setPhotoLastError(photo.id, 'Photo belongs to a different signed-in user');
              await incrementPhotoRetryCount(photo.id);
              changedCount++;
              return;
            }
          } catch {
            // Best-effort cross-check; don't block sync on lookup failure.
          }
        }

        // Legacy `pending/` rewrite — only safe when there is no capturedBy
        // tag (pre-S23 records) AND the current user owns the parent inspection.
        if (photo.photoUrl?.startsWith('pending/')) {
          if (!currentUserId) {
            if (import.meta.env.DEV) {
              console.log('[Sync Manager] Skipping pending photo (no auth):', photo.id);
            }
            return;
          }
          if (capturedBy && capturedBy !== currentUserId) {
            // Already handled above, but defense in depth.
            return;
          }
          // Verify ownership of parent inspection before rewriting.
          let parentOwnerId: string | null = null;
          try {
            const { getOfflineInspection, getOfflineDailyAssessment } = await import('./offline-storage');
            const parent = (await getOfflineInspection(photo.inspectionId)) || (await getOfflineDailyAssessment(photo.inspectionId));
            parentOwnerId = parent?.inspector_id || parent?.user_id || null;
          } catch {
            parentOwnerId = null;
          }
          if (parentOwnerId && parentOwnerId !== currentUserId) {
            console.warn('[Sync Manager] Legacy pending photo belongs to a different user — dead-lettering:', photo.id);
            await setPhotoLastError(photo.id, 'Photo belongs to a different signed-in user');
            await incrementPhotoRetryCount(photo.id);
            changedCount++;
            return;
          }

          const normalizedPath = photo.photoUrl.replace(/^pending\//, `${currentUserId}/`);
          photo.photoUrl = normalizedPath;
          try {
            const { updatePhotoUrl, setPhotoCapturedBy } = await import('./offline-storage');
            await updatePhotoUrl(photo.id, normalizedPath);
            // Stamp capturedBy now that we've definitively bound it.
            await setPhotoCapturedBy(photo.id, currentUserId);
          } catch (e) {
            console.warn('[Sync Manager] Failed to persist normalized path:', e);
          }
          if (import.meta.env.DEV) {
            console.log('[Sync Manager] Normalized legacy pending path to:', normalizedPath);
          }
        }

        // Guard: blob must exist (may have been nullified by a previous partial success)
        if (!photo.blob) {
          if (import.meta.env.DEV) {
            console.warn('[Sync Manager] Skipping photo with null blob (already uploaded?):', photo.id);
          }
          await markPhotoAsUploaded(photo.id, photo.photoUrl || photo.id);
          changedCount++;
          return;
        }

        let user = await getUserWithCache();
        if (!user) {
          const { getOfflineUserId } = await import('./cached-auth');
          const offlineId = getOfflineUserId();
          if (offlineId) user = { id: offlineId } as any;
        }
        if (!user) throw new Error("Not authenticated");

        // Use per-photo metadata with backward-compatible defaults
        const bucket = photo.storageBucket || 'inspection-photos';
        const table = photo.tableName || 'inspection_photos';
        const fkColumn = photo.foreignKeyColumn || 'inspection_id';

        const fileExt = photo.fileName.split('.').pop();
        const fallbackFileName = `${user.id}/${photo.inspectionId}/${Date.now()}.${fileExt}`;
        const fileName = photo.photoUrl || fallbackFileName;
        
        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from(bucket as any)
          .upload(fileName, photo.blob, {
            contentType: photo.blob.type || 'image/jpeg',
            upsert: true,
          });

        if (uploadError) {
          // S22: Classify upload errors instead of treating all as permanent.
          const cls = classifyPhotoError(uploadError);
          if (import.meta.env.DEV) {
            console.log(`[Sync Manager] Upload error classified as ${cls.kind} for ${photo.id}:`, cls.message);
          }
          if (cls.kind === 'success-equivalent') {
            // Storage already has the object — proceed to DB insert path.
          } else if (cls.kind === 'transient') {
            console.warn('[Sync Manager] Transient upload error, will retry next cycle:', photo.id, cls.message);
            // Do NOT bump retryCount; do NOT stamp lastError persistently.
            return;
          } else {
            // permanent
            console.error('[Sync Manager] Permanent upload error for photo:', photo.id, cls.message);
            await setPhotoLastError(photo.id, cls.message);
            await incrementPhotoRetryCount(photo.id);
            changedCount++;
            return;
          }
        }

        // Deduplication guard: check if a DB row already exists for this photo_url
        const { data: existing } = await (supabase
          .from(table as any) as any)
          .select('id')
          .eq('photo_url', fileName)
          .eq(fkColumn, photo.inspectionId)
          .maybeSingle();

        if (!existing) {
          // Save to database with file path (signed URLs generated on read)
          const { error: dbError } = await (supabase
            .from(table as any) as any)
            .insert({
              [fkColumn]: photo.inspectionId,
              photo_url: fileName,
              photo_section: photo.section,
              caption: photo.caption || photo.section || 'Photo',
            });

          if (dbError) {
            // S22: Classify DB errors. 23505 / duplicate already maps to
            // success-equivalent in classifyPhotoError.
            const cls = classifyPhotoError(dbError);
            if (import.meta.env.DEV) {
              console.log(`[Sync Manager] DB insert error classified as ${cls.kind} for ${photo.id}:`, cls.message);
            }
            if (cls.kind === 'success-equivalent') {
              if (import.meta.env.DEV) {
                console.log('[Sync Manager] Unique constraint hit (race OK), treating as success:', photo.id);
              }
            } else if (cls.kind === 'transient') {
              console.warn('[Sync Manager] Transient DB insert error, will retry next cycle:', photo.id, cls.message);
              return;
            } else {
              console.error('[Sync Manager] Permanent DB insert error for photo:', photo.id, cls.message);
              await setPhotoLastError(photo.id, cls.message);
              await incrementPhotoRetryCount(photo.id);
              changedCount++;
              return;
            }
          }
        } else if (import.meta.env.DEV) {
          console.log('[Sync Manager] Skipped duplicate DB row for photo:', photo.id);
        }

        // Mark as uploaded and release blob from IndexedDB (also clears lastError)
        await markPhotoAsUploaded(photo.id, fileName);
        processedIds.add(photo.id);
        successCount++;
        changedCount++;

        if (import.meta.env.DEV) {
          console.log('[Sync Manager] Uploaded photo:', photo.id);
        }
      } catch (error) {
        // S22: Unexpected throws (e.g. auth/network exceptions outside the
        // explicit error checks). Classify before bumping retryCount.
        const cls = classifyPhotoError(error);
        console.error(`[Sync Manager] Failed to upload photo (${cls.kind}):`, photo.id, cls.message);
        if (cls.kind === 'transient') {
          // Retry next cycle without counting toward the dead-letter ceiling.
          return;
        }
        await setPhotoLastError(photo.id, cls.message);
        await incrementPhotoRetryCount(photo.id);
      }
    });

    if (import.meta.env.DEV) {
      console.log(`[Sync Manager] Photo sync completed: ${successCount} photos, ${remaining} remaining`);
    }
    
    return { remaining };
  } catch (error) {
    console.error('[Sync Manager] Photo sync error:', error);
    return { remaining: 0 };
  }
}

// NOTE: The duplicate "online" listener that was here has been removed (P1).
// All sync orchestration (including photo sync) is handled by useAutoSync.tsx
// which provides proper guards: cooldown, batch limits, syncInProgressRef.
