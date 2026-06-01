/**
 * Cross-platform photo upload status derivation.
 *
 * Standing rule (mem://engineering/cross-platform-shared-path-rule): every
 * fix lands in a shared module. This file is consumed by `PhotoGallery`,
 * `ItemPhotoUpload`, and (transitively) `PhotoCapture` so browser, PWA,
 * iPad, desktop, and mobile all render the same plain-English upload
 * status from the same IndexedDB row shape.
 *
 * No schema change: every field read here already exists on the `photos`
 * store (offline-storage.ts ~line 143-165). This module is pure and
 * dependency-free so it is trivially testable under Vitest.
 */

/**
 * The raw shape we read from. Mirrors the IDB `photos` row fields the
 * sync layer and `markPhotoAsUploaded`/`setPhotoLastError`/
 * `markPhotoTransientFailure` already maintain. All fields optional so
 * partially-migrated legacy rows are still classifiable.
 */
export interface PhotoStatusInput {
  uploaded?: 0 | 1 | boolean | null;
  uploadedAt?: number | null;
  lastError?: string | null;
  lastErrorAt?: number | null;
  nextRetryAt?: number | null;
  retryCount?: number | null;
  /** Capture timestamp; used to age "waiting" → "saved-local" when offline. */
  createdAt?: number | string | null;
}

export type PhotoStatusKind =
  | 'uploaded'
  | 'uploading'
  | 'waiting'
  | 'saved-local'
  | 'failed';

export interface PhotoStatus {
  kind: PhotoStatusKind;
  /** Plain-English label intended for direct render. */
  label: string;
  /** True when the user should see a "Retry" affordance on the tile. */
  canRetry: boolean;
  /** True when the photo bytes are confirmed on the server. */
  isServerSafe: boolean;
  /** True when the bytes are at least on this device (IDB) even if not yet on server. */
  isLocallySafe: boolean;
}

const LABELS: Record<PhotoStatusKind, string> = {
  uploaded: 'Uploaded',
  uploading: 'Uploading',
  waiting: 'Waiting to upload',
  'saved-local': 'Saved on this device',
  failed: 'Upload failed — tap to retry',
};

/**
 * Pure: derive the user-facing status for a single photo.
 *
 * Branches (first match wins):
 *  1. `uploaded` truthy → "Uploaded".
 *  2. `lastError` set AND not currently inside a `nextRetryAt` backoff window
 *     AND retryCount ≥ 1 → "Upload failed — tap to retry".
 *     (We require retryCount ≥ 1 so the very first attempt that hasn't
 *     even tried yet isn't shown as failed.)
 *  3. `nextRetryAt` set and still in the future → "Waiting to upload".
 *  4. Online and we have a blob queued but no error yet → "Uploading".
 *  5. Offline (or no network signal) with no error → "Saved on this device".
 *  6. Default → "Waiting to upload".
 */
export function derivePhotoStatus(
  photo: PhotoStatusInput,
  ctx: { now?: number; isOnline?: boolean } = {},
): PhotoStatus {
  const now = ctx.now ?? Date.now();
  const isOnline = ctx.isOnline ?? true;
  const uploaded = photo.uploaded === true || photo.uploaded === 1;

  if (uploaded) {
    return makeStatus('uploaded');
  }

  const hasError = !!photo.lastError;
  const retryCount = typeof photo.retryCount === 'number' ? photo.retryCount : 0;
  const nextRetryAt = typeof photo.nextRetryAt === 'number' ? photo.nextRetryAt : 0;
  const inBackoff = nextRetryAt > now;

  // Hard-failed: at least one attempt has stamped lastError and we are NOT
  // currently inside a scheduled backoff window. The retryCount gate keeps
  // brand-new photos from flashing "failed" before the first try.
  if (hasError && !inBackoff && retryCount >= 1) {
    return makeStatus('failed');
  }

  // Transient failure waiting out its backoff window.
  if (inBackoff) {
    return makeStatus('waiting');
  }

  // No error yet — distinguish "actively trying to send" from "parked locally".
  if (isOnline) {
    return makeStatus('uploading');
  }
  return makeStatus('saved-local');
}

function makeStatus(kind: PhotoStatusKind): PhotoStatus {
  return {
    kind,
    label: LABELS[kind],
    canRetry: kind === 'failed',
    isServerSafe: kind === 'uploaded',
    isLocallySafe: true,
  };
}

/**
 * Standing message for the Lovable preview no-op. Surfaced when an
 * upload is attempted from an `id-preview--…lovable.app` URL where
 * writes are blocked by design. Centralised so PhotoCapture and
 * ItemPhotoUpload show identical wording and a single test pins it.
 */
export const LOVABLE_PREVIEW_UPLOAD_MESSAGE =
  'Photo uploads are disabled in preview. Please use rwreports.com or the installed app.';
