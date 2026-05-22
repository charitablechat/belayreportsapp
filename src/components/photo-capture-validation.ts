/**
 * Pure helpers for `PhotoCapture` file validation.
 *
 * Lives outside `PhotoCapture.tsx` so vitest can exercise the validator
 * without spinning up React + dnd-kit + sonner + IndexedDB mocks.
 */

export const SUPPORTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const MAX_FILE_SIZE_MB = 20;

/**
 * Audit M2: image extensions accepted by `validateFile` when `file.type` is
 * empty. iOS share-sheet / Files-app uploads (especially drag-and-drop on
 * iPadOS) frequently arrive with `file.type === ''` even though the bytes
 * are a valid JPEG/PNG/HEIC. The previous validator rejected these
 * outright with a misleading "Unsupported file type: unknown" toast.
 */
export const SUPPORTED_EXTENSIONS_REGEX = /\.(jpe?g|png|webp|heic|heif)$/i;

export function validateFile(
  file: File,
): { valid: boolean; error?: string } {
  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty (0 bytes). Please choose a different photo.',
    };
  }
  const hasImageExtension = SUPPORTED_EXTENSIONS_REGEX.test(file.name);
  if (!file.type) {
    if (!hasImageExtension) {
      return {
        valid: false,
        error:
          'Could not determine file type. Please use a .jpg, .png, .webp, or .heic photo.',
      };
    }
    // file.type empty + image-shaped name → trust the name; compressImage
    // / createImageBitmap will reject genuine non-images downstream.
  } else if (
    !SUPPORTED_TYPES.includes(file.type) &&
    !file.type.startsWith('image/')
  ) {
    return {
      valid: false,
      error: `Unsupported file type: ${file.type}. Please use JPEG, PNG, or WebP.`,
    };
  }
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    return {
      valid: false,
      error: `File too large (${fileSizeMB.toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
    };
  }
  return { valid: true };
}

/**
 * Postgres unique-violation classification for the photo-row INSERT path.
 *
 * Both `PhotoCapture.uploadPhotoInBackground` (foreground fast path) and the
 * sync-manager photo loop pre-check for an existing row by
 * (photo_url, foreign_key) before INSERT. When the two paths race — or when
 * a retry fires while the foreground insert is still in flight — both
 * pre-checks return empty, both INSERTs are attempted, and the loser is
 * rejected by `idx_<table>_no_duplicates` with Postgres SQLSTATE 23505.
 *
 * Treat that specific shape as success-equivalent: the storage object is
 * already uploaded, the canonical row already exists, and `markPhotoAsUploaded`
 * should proceed. Any other error must surface.
 *
 * Mirrors the inline predicate previously in PhotoCapture so vitest can pin
 * the contract that the new `idx_training_photos_no_duplicates` migration
 * depends on.
 */
export function isDuplicateInsertError(
  err: { message?: string | null; code?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  const msg = err.message ?? '';
  const code = err.code ?? '';
  return msg.includes('duplicate') || code.includes('23505');
}
