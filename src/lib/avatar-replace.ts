/**
 * Atomic avatar replace helper.
 *
 * Ordering contract (Slice 2):
 *   1. Validate file (size + mimetype)
 *   2. Upload NEW avatar at `${userId}/<opaque-id>.<ext>` with upsert:false
 *   3. Update `profiles.avatar_url` to the new public URL
 *      - if this fails, best-effort remove the orphan new object,
 *        then surface the ORIGINAL database error (cleanup error never masks it)
 *   4. Return new publicUrl + safe-to-delete oldPath (if any)
 *
 * Caller is responsible for:
 *   - committing local UI state / profile cache AFTER step 3 succeeds
 *   - performing best-effort old-avatar deletion via `safeDeleteOldAvatar()`
 *     ONLY AFTER local/cache state has been updated
 *
 * Old-avatar deletion is intentionally NOT performed inside `atomicReplaceAvatar`
 * so callers can guarantee the UI/cache is consistent with the committed row
 * before any destructive cleanup runs.
 */

const VALID_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BUCKET = 'avatars';

// Extension whitelist (mirrors VALID_MIME_TYPES). Lower-cased.
const SAFE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export type AvatarValidationError =
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'EMPTY_FILE';

export class AvatarReplaceError extends Error {
  code:
    | AvatarValidationError
    | 'UPLOAD_FAILED'
    | 'DB_UPDATE_FAILED'
    | 'NO_PUBLIC_URL';
  cause?: unknown;
  constructor(code: AvatarReplaceError['code'], message: string, cause?: unknown) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

export interface AtomicReplaceResult {
  publicUrl: string;
  /** Storage key (e.g. `${userId}/<uuid>.png`) of the NEW object. */
  newPath: string;
  /**
   * Storage key of the OLD object, ONLY if it could be safely parsed AND
   * verified to belong to the current user's folder in the avatars bucket.
   * Null in every other case (null/empty/malformed/external/wrong-user).
   */
  oldPathToCleanup: string | null;
}

// Minimal shape we need from the Supabase client — keeps tests trivial.
export interface AvatarSupabaseLike {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: Blob | File,
        opts?: { cacheControl?: string; upsert?: boolean; contentType?: string },
      ): Promise<{ data: unknown; error: { message: string } | null }>;
      remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

/** Generate an opaque, collision-resistant file id. */
export function generateOpaqueId(): string {
  // Prefer randomUUID (Safari 15.4+ / iPadOS 15.4+).
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Web Crypto fallback (never Date.now()+Math.random()).
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure random source unavailable');
}

/** Pick a safe file extension from the file (mime first, then name). */
export function pickSafeExtension(file: { name?: string; type?: string }): string {
  const mime = (file.type ?? '').toLowerCase();
  const mimeExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  if (mime in mimeExt) return mimeExt[mime];
  const name = file.name ?? '';
  const dot = name.lastIndexOf('.');
  const raw = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (SAFE_EXTENSIONS.has(raw)) return raw === 'jpeg' ? 'jpg' : raw;
  return 'bin';
}

export function validateAvatarFile(file: File | Blob & { size: number; type: string; name?: string }): void {
  if (!file || file.size === 0) {
    throw new AvatarReplaceError('EMPTY_FILE', 'File is empty.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new AvatarReplaceError('FILE_TOO_LARGE', 'Image must be 5MB or smaller.');
  }
  if (!VALID_MIME_TYPES.includes(file.type as typeof VALID_MIME_TYPES[number])) {
    throw new AvatarReplaceError('UNSUPPORTED_TYPE', 'Unsupported image type.');
  }
}

/**
 * Parse an existing avatar URL and return the storage key ONLY IF it clearly
 * belongs to the `avatars` bucket and to the current user's folder.
 *
 * Returns null for null/empty/malformed/external/wrong-bucket/wrong-user URLs.
 * Never throws.
 */
export function parseOwnedAvatarStorageKey(
  oldUrl: string | null | undefined,
  userId: string,
): string | null {
  if (!oldUrl || typeof oldUrl !== 'string' || !userId) return null;
  let parsed: URL;
  try {
    parsed = new URL(oldUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  // Expect: /storage/v1/object/public/avatars/<userId>/<file>
  // (or signed/object variants — we only allow public for cleanup safety)
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = parsed.pathname.indexOf(marker);
  if (idx < 0) return null;
  const key = parsed.pathname.slice(idx + marker.length);
  if (!key) return null;
  // Decode percent-encoding in the path before checking ownership.
  let decoded: string;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    return null;
  }
  // Must be under `${userId}/...` with at least one filename segment.
  const prefix = `${userId}/`;
  if (!decoded.startsWith(prefix)) return null;
  const tail = decoded.slice(prefix.length);
  // Disallow path traversal or nested folders we did not create.
  if (!tail || tail.includes('..') || tail.includes('/')) return null;
  return decoded;
}

/**
 * Step 1–3 of the atomic replace contract. Does NOT delete the old avatar.
 */
export async function atomicReplaceAvatar(args: {
  supabase: AvatarSupabaseLike;
  userId: string;
  oldUrl: string | null | undefined;
  file: File;
  /** Override id generator (used by tests). */
  generateId?: () => string;
}): Promise<AtomicReplaceResult> {
  const { supabase, userId, oldUrl, file } = args;
  if (!userId) throw new AvatarReplaceError('DB_UPDATE_FAILED', 'Missing user id.');

  validateAvatarFile(file);

  const id = (args.generateId ?? generateOpaqueId)();
  const ext = pickSafeExtension(file);
  const newPath = `${userId}/${id}.${ext}`;

  // 2. Upload new avatar (collision-resistant, upsert:false).
  const uploadRes = await supabase.storage.from(BUCKET).upload(newPath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (uploadRes.error) {
    throw new AvatarReplaceError(
      'UPLOAD_FAILED',
      'Failed to upload new avatar.',
      uploadRes.error,
    );
  }

  // Get public URL.
  const urlRes = supabase.storage.from(BUCKET).getPublicUrl(newPath);
  const publicUrl = urlRes?.data?.publicUrl;
  if (!publicUrl) {
    // Best-effort cleanup of the orphan upload.
    await safeRemoveQuiet(supabase, newPath);
    throw new AvatarReplaceError('NO_PUBLIC_URL', 'Could not resolve avatar URL.');
  }

  // 3. Commit DB row.
  const updateRes = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', userId);

  if (updateRes.error) {
    // Best-effort orphan cleanup — must NOT mask the original DB error.
    await safeRemoveQuiet(supabase, newPath);
    throw new AvatarReplaceError(
      'DB_UPDATE_FAILED',
      'Failed to update profile.',
      updateRes.error,
    );
  }

  return {
    publicUrl,
    newPath,
    oldPathToCleanup: parseOwnedAvatarStorageKey(oldUrl, userId),
  };
}

async function safeRemoveQuiet(supabase: AvatarSupabaseLike, path: string): Promise<void> {
  try {
    const res = await supabase.storage.from(BUCKET).remove([path]);
    if (res.error) {
      // Non-sensitive metadata only — no path, no URL.
      console.warn('[avatar-replace] orphan cleanup failed', {
        scope: 'avatar-replace.orphan-cleanup',
      });
    }
  } catch {
    console.warn('[avatar-replace] orphan cleanup threw', {
      scope: 'avatar-replace.orphan-cleanup',
    });
  }
}

/**
 * Best-effort deletion of the previous avatar. Never throws. Logs only
 * non-sensitive scope metadata on failure (no paths, no URLs).
 */
export async function safeDeleteOldAvatar(
  supabase: AvatarSupabaseLike,
  oldPath: string | null,
): Promise<{ deleted: boolean; failed: boolean }> {
  if (!oldPath) return { deleted: false, failed: false };
  try {
    const res = await supabase.storage.from(BUCKET).remove([oldPath]);
    if (res.error) {
      console.warn('[avatar-replace] old-avatar cleanup failed', {
        scope: 'avatar-replace.old-cleanup',
      });
      return { deleted: false, failed: true };
    }
    return { deleted: true, failed: false };
  } catch {
    console.warn('[avatar-replace] old-avatar cleanup threw', {
      scope: 'avatar-replace.old-cleanup',
    });
    return { deleted: false, failed: true };
  }
}
