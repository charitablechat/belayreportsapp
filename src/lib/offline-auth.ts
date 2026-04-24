/**
 * Offline Authentication Module (Phase 2 — refresh-token based)
 *
 * Trust-then-verify offline sign-in:
 * 1. On every successful ONLINE sign-in we capture the user's refresh token.
 * 2. On a later OFFLINE sign-in we verify the email has a captured token,
 *    then build a synthetic session in a dedicated localStorage slot
 *    (NOT Supabase's real auth-token key). The refresh token is never
 *    used while offline — its presence simply proves "this user has
 *    successfully signed in on this device before."
 * 3. On reconnect we exchange the refresh token for a real session via
 *    `supabase.auth.refreshSession({ refresh_token })`. If it succeeds the
 *    real Supabase session takes over and IndexedDB is migrated if the
 *    deterministic-UUID needs to be replaced with the real userId. If the
 *    token has been revoked server-side we delete the entry and force the
 *    user to sign in online.
 *
 * Plain passwords are NEVER stored on the device.
 */

import { openDB } from 'idb';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OFFLINE_PLACEHOLDER_TOKEN } from '@/lib/synthetic-session-guard';
import {
  writeCredentialAtomic,
  readCredentialResilient,
  deleteCredentialResilient,
} from '@/lib/auth-resilience';

const OFFLINE_AUTH_DB = 'offline-auth-store';
const OFFLINE_AUTH_DB_VERSION = 2; // bumped to add `offline_auth` store

/** Dedicated storage key — separate from `sb-{ref}-auth-token`. */
export const SYNTHETIC_SESSION_KEY = 'offline_synthetic_session';

/** Legacy keys we wipe on boot. */
const LEGACY_PENDING_FLAG = 'offline_auth_pending';
const PENDING_OFFLINE_SIGNOUT_KEY = 'pending_offline_signout';

/** Synthetic sessions expire 30 days after capture (hard cap). */
const SYNTHETIC_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Phase 4b — bounded offline window. After this many days *without* an online
 * reconciliation, the user is forced back to the online sign-in screen even
 * if the synthetic session blob is still valid. 14 days by default.
 */
const OFFLINE_WINDOW_DAYS_DEFAULT = 14;
const OFFLINE_WINDOW_WARNING_DAYS = 2; // soft warning at T-2 days

function getOfflineWindowMs(): number {
  // Allow admins/devs to tune via localStorage without a redeploy.
  try {
    const raw = localStorage.getItem('offline_window_days');
    if (raw) {
      const days = parseInt(raw, 10);
      if (Number.isFinite(days) && days > 0 && days <= 90) {
        return days * 24 * 60 * 60 * 1000;
      }
    }
  } catch {
    // ignore
  }
  return OFFLINE_WINDOW_DAYS_DEFAULT * 24 * 60 * 60 * 1000;
}

interface OfflineAuthDB {
  /** Lightweight email→userId mapping, kept for migration paths. */
  user_mappings: {
    key: string;
    value: { email: string; userId: string; savedAt: number };
  };
  /** Legacy XOR-password store — wiped on boot, never re-populated. */
  pending_credentials: {
    key: string;
    value: unknown;
  };
  /** New refresh-token-based offline auth entries, keyed by lowercase email. */
  offline_auth: {
    key: string;
    value: {
      email: string;
      userId: string;
      refreshToken: string;
      capturedAt: number;
    };
  };
}

async function getAuthDB() {
  return openDB<OfflineAuthDB>(OFFLINE_AUTH_DB, OFFLINE_AUTH_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('user_mappings')) {
        db.createObjectStore('user_mappings', { keyPath: 'email' });
      }
      if (!db.objectStoreNames.contains('pending_credentials')) {
        db.createObjectStore('pending_credentials', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('offline_auth')) {
        db.createObjectStore('offline_auth', { keyPath: 'email' });
      }
    },
  });
}

/** Deterministic UUID derived from email; only used when there's no captured userId yet. */
async function generateDeterministicUserId(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  // L1: Force a strict RFC 4122 v4 layout.
  //   - 13th hex digit (version nibble) must be '4'
  //   - 17th hex digit (variant nibble) must be 8/9/a/b
  // The previous implementation set the version but left the variant nibble
  // free, producing strings that strict UUID parsers (and a future tightening
  // of Postgres' uuid type) could reject.
  const variantNibble = (parseInt(hex[16], 16) & 0x3 | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variantNibble}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ==================== PUBLIC API ====================

/**
 * Save an email→userId mapping AND, if we have one, the refresh token captured
 * at sign-in. Called after every successful online sign-in.
 *
 * `refreshToken` is optional so old call sites that only pass (email, userId)
 * keep working; they will populate the user_mappings store but won't enable
 * offline sign-in until a refresh token is also captured.
 */
export async function saveUserMapping(
  email: string,
  userId: string,
  refreshToken?: string
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  try {
    const db = await getAuthDB();
    await db.put('user_mappings', {
      email: normalizedEmail,
      userId,
      savedAt: Date.now(),
    });

    if (refreshToken) {
      const entry = {
        email: normalizedEmail,
        userId,
        refreshToken,
        capturedAt: Date.now(),
      };
      await db.put('offline_auth', entry);
      // Phase 1: mirror to redundant + checksummed slots so a crash or
      // partial-write that corrupts the legacy entry can still be recovered.
      writeCredentialAtomic(`offline-auth:${normalizedEmail}`, entry).catch(() => {});
    }

    if (import.meta.env.DEV) {
      console.log('[OfflineAuth] Saved user mapping for', normalizedEmail, refreshToken ? '(with refresh token)' : '');
    }
  } catch (error) {
    console.warn('[OfflineAuth] Failed to save user mapping:', error);
  }
}

export async function getStoredUserId(email: string): Promise<string | null> {
  try {
    const db = await getAuthDB();
    const mapping = await db.get('user_mappings', email.toLowerCase().trim());
    return mapping?.userId || null;
  } catch (error) {
    console.warn('[OfflineAuth] Failed to get stored userId:', error);
    return null;
  }
}

/** Look up a captured offline-auth entry (refresh token + userId) for an email. */
export async function getOfflineAuthEntry(email: string) {
  const normalizedEmail = email.toLowerCase().trim();
  try {
    const db = await getAuthDB();
    const entry = await db.get('offline_auth', normalizedEmail);
    if (entry) return entry;

    // Phase 1: legacy entry missing/corrupt — try the resilient mirror.
    const resilient = await readCredentialResilient<{
      email: string;
      userId: string;
      refreshToken: string;
      capturedAt: number;
    }>(`offline-auth:${normalizedEmail}`);
    if (resilient.ok && resilient.value) {
      // Self-heal the legacy store so subsequent reads are fast.
      try { await db.put('offline_auth', resilient.value); } catch { /* ignore */ }
      return resilient.value;
    }
    return null;
  } catch (error) {
    console.warn('[OfflineAuth] Failed to read offline_auth entry:', error);
    // Last-resort: try the resilient mirror even if the legacy DB is broken.
    try {
      const resilient = await readCredentialResilient<{
        email: string;
        userId: string;
        refreshToken: string;
        capturedAt: number;
      }>(`offline-auth:${normalizedEmail}`);
      return resilient.ok ? resilient.value : null;
    } catch {
      return null;
    }
  }
}

/**
 * Create an OFFLINE session.
 *
 * Requires a previous successful online sign-in on this device (so we have a
 * captured refresh token). If none exists, throws — there is no way to verify
 * a brand-new user offline.
 *
 * `password` is accepted for API compatibility but is NEVER stored.
 */
export async function createOfflineSession(email: string, _password: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const entry = await getOfflineAuthEntry(normalizedEmail);

  if (!entry) {
    // No captured refresh token → user has never signed in online on this device.
    // Refuse offline sign-in so we don't silently grant access.
    throw new Error(
      'No offline credentials available. Please connect to the internet and sign in once to enable offline access.'
    );
  }

  const userId = entry.userId || (await generateDeterministicUserId(normalizedEmail));
  const capturedAt = Date.now();

  const offlineWindowMs = getOfflineWindowMs();
  const offlineExpiresAt = capturedAt + offlineWindowMs;

  const syntheticSession = {
    access_token: OFFLINE_PLACEHOLDER_TOKEN,
    refresh_token: 'offline_placeholder',
    // Real expiry: 30 days after this offline sign-in.
    expires_at: Math.floor((capturedAt + SYNTHETIC_SESSION_TTL_MS) / 1000),
    token_type: 'bearer',
    user: {
      id: userId,
      email: normalizedEmail,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date(capturedAt).toISOString(),
    },
    // Internal marker so read paths can distinguish synthetic from real sessions.
    __synthetic: true as const,
    __capturedAt: capturedAt,
    /** Phase 4b — bounded offline window (ms epoch). */
    __offlineExpiresAt: offlineExpiresAt,
  };

  // Write to DEDICATED slot — not Supabase's real session key.
  localStorage.setItem(SYNTHETIC_SESSION_KEY, JSON.stringify(syntheticSession));
  // Mark that a refresh attempt should run on reconnect.
  localStorage.setItem(LEGACY_PENDING_FLAG, 'true');

  if (import.meta.env.DEV) {
    console.log('[OfflineAuth] Synthetic session created (refresh-token mode)', {
      email: normalizedEmail,
      userId,
      offlineExpiresAt: new Date(offlineExpiresAt).toISOString(),
    });
  }
}

/**
 * Delete a captured offline-auth entry (e.g. after a failed offline sign-in
 * or after an explicit online sign-out).
 */
export async function deleteOfflineAuthEntry(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  try {
    const db = await getAuthDB();
    await db.delete('offline_auth', normalizedEmail);
  } catch (error) {
    console.warn('[OfflineAuth] Failed to delete offline_auth entry:', error);
  }
  // Phase 1: also clear the redundant slots so a stale token can't be revived.
  deleteCredentialResilient(`offline-auth:${normalizedEmail}`).catch(() => {});
}

/** Read the synthetic session (or null) from the dedicated slot. */
export function readSyntheticSession(): null | {
  user: { id: string; email?: string };
  expires_at: number;
  __synthetic: true;
  __capturedAt: number;
  __offlineExpiresAt?: number;
} {
  try {
    const raw = localStorage.getItem(SYNTHETIC_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
    // Hard cap: synthetic sessions die 30 days after capture regardless.
    if (parsed.expires_at && parsed.expires_at * 1000 < Date.now()) {
      localStorage.removeItem(SYNTHETIC_SESSION_KEY);
      return null;
    }
    // Phase 4b — bounded offline window. If we've been offline longer than
    // the configured window, force the user back online to re-verify.
    if (
      typeof parsed.__offlineExpiresAt === 'number' &&
      parsed.__offlineExpiresAt < Date.now()
    ) {
      localStorage.removeItem(SYNTHETIC_SESSION_KEY);
      localStorage.removeItem(LEGACY_PENDING_FLAG);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Phase 4b — return ms remaining in the bounded offline window, or `null`
 * if there is no active synthetic session or no bound was set.
 */
export function getOfflineWindowRemainingMs(): number | null {
  const s = readSyntheticSession();
  if (!s || typeof s.__offlineExpiresAt !== 'number') return null;
  return Math.max(0, s.__offlineExpiresAt - Date.now());
}

/** True when the synthetic session is within the soft-warning window (T-2 days). */
export function isOfflineWindowExpiringSoon(): boolean {
  const remaining = getOfflineWindowRemainingMs();
  if (remaining === null) return false;
  const warningMs = OFFLINE_WINDOW_WARNING_DAYS * 24 * 60 * 60 * 1000;
  return remaining > 0 && remaining <= warningMs;
}

export function clearSyntheticSession(): void {
  localStorage.removeItem(SYNTHETIC_SESSION_KEY);
  localStorage.removeItem(LEGACY_PENDING_FLAG);
}

export function hasPendingOfflineAuth(): boolean {
  // Either an explicit pending flag OR an active synthetic session means we
  // should attempt to reconcile when we come back online.
  return (
    localStorage.getItem(LEGACY_PENDING_FLAG) === 'true' ||
    !!readSyntheticSession()
  );
}

/**
 * On reconnect: try to upgrade the synthetic session to a real one by
 * exchanging the captured refresh token. On failure, force the user to sign
 * in online again.
 */
export async function verifyAndReconcileOfflineAuth(): Promise<boolean> {
  if (!navigator.onLine) return false;

  const synthetic = readSyntheticSession();
  if (!synthetic) {
    localStorage.removeItem(LEGACY_PENDING_FLAG);
    return false;
  }

  const email = synthetic.user.email?.toLowerCase().trim();
  if (!email) {
    clearSyntheticSession();
    return false;
  }

  const entry = await getOfflineAuthEntry(email);
  if (!entry?.refreshToken) {
    if (import.meta.env.DEV) {
      console.warn('[OfflineAuth] No captured refresh token to reconcile — clearing synthetic session');
    }
    clearSyntheticSession();
    return false;
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: entry.refreshToken,
    });

    if (error || !data.session?.user) {
      console.warn('[OfflineAuth] Refresh-token exchange failed:', error?.message);
      toast.error(
        'Your offline session has expired. Please sign in again.',
        { duration: 10000 }
      );
      // Revoked / expired token — drop the entry and the synthetic session.
      await deleteOfflineAuthEntry(email);
      clearSyntheticSession();
      return false;
    }

    const realUserId = data.session.user.id;
    const syntheticUserId = synthetic.user.id;

    // Capture the freshly-rotated refresh token for next time.
    await saveUserMapping(email, realUserId, data.session.refresh_token);

    if (realUserId !== syntheticUserId) {
      console.log('[OfflineAuth] UserId changed — migrating IndexedDB data', {
        from: syntheticUserId,
        to: realUserId,
      });
      await migrateUserData(syntheticUserId, realUserId);
      // 1.A — Rewrite queued (not-yet-uploaded) photo paths so the next
      // syncPhotos() cycle POSTs to <newUid>/... and passes storage RLS.
      // Already-uploaded photos keep their <oldUid>/ path (see C7 note in
      // migrateUserData) — their storage object lives there forever.
      await migratePendingPhotoPaths(syntheticUserId, realUserId);
      toast.success('Your offline data has been linked to your account.');
    } else {
      toast.success('Offline session verified.');
    }

    clearSyntheticSession();
    return true;
  } catch (error) {
    console.error('[OfflineAuth] Error during reconcile:', error);
    return false;
  }
}

async function migrateUserData(oldUserId: string, newUserId: string): Promise<void> {
  try {
    const { getDB } = await import('./offline-storage');
    const db = await getDB();

    const storesToMigrate = [
      { name: 'inspections' as const, idField: 'inspector_id' },
      { name: 'trainings' as const, idField: 'inspector_id' },
      { name: 'daily_assessments' as const, idField: 'inspector_id' },
    ];

    let totalMigrated = 0;

    for (const { name, idField } of storesToMigrate) {
      try {
        // Read phase in its own readonly tx (free to await between calls).
        const readTx = db.transaction(name, 'readonly');
        const allRecords = await readTx.objectStore(name).getAll();
        await readTx.done;

        const records = allRecords as Array<Record<string, unknown>>;
        const toMigrate = records.filter((r) => r[idField] === oldUserId);
        if (toMigrate.length === 0) continue;

        // Write phase: open tx, fire all puts synchronously (no await between
        // requests, otherwise the tx auto-closes), then await tx.done.
        const writeTx = db.transaction(name, 'readwrite');
        const writeStore = writeTx.objectStore(name);
        const puts = toMigrate.map((record) => {
          record[idField] = newUserId;
          return writeStore.put(record);
        });
        await Promise.all(puts);
        await writeTx.done;
        totalMigrated += toMigrate.length;
      } catch (storeError) {
        console.warn(`[OfflineAuth] Failed to migrate store ${name}:`, storeError);
      }
    }

    // C7: Photo paths for ALREADY-UPLOADED photos are intentionally NOT
    // rewritten. The storage object lives under <oldUserId>/... forever;
    // rewriting the IDB pointer would make it point at a non-existent key.
    // Reads use signed URLs that work regardless of which uid prefix is in
    // the path, so the original key remains valid post-reconcile.
    // PENDING (not-yet-uploaded) photos ARE rewritten — see
    // `migratePendingPhotoPaths` below — because their next upload must
    // target the new authenticated uid to satisfy storage RLS.

    if (import.meta.env.DEV) {
      console.log(`[OfflineAuth] Migrated ${totalMigrated} records ${oldUserId} → ${newUserId}`);
    }
  } catch (error) {
    console.error('[OfflineAuth] Data migration failed:', error);
  }
}

/**
 * 1.A — Rewrite IDB photo paths for queued (not-yet-uploaded) photos so the
 * next sync cycle uploads them under the real authenticated uid. Already-
 * uploaded photos are left alone (their storage object lives under the old
 * prefix and signed URLs work regardless).
 */
export async function migratePendingPhotoPaths(oldUserId: string, newUserId: string): Promise<void> {
  if (!oldUserId || !newUserId || oldUserId === newUserId) return;
  try {
    const { getDB, toUploadedFlag } = await import('./offline-storage');
    const db = await getDB();

    type PhotoRow = {
      uploaded?: 0 | 1 | boolean;
      photoUrl?: unknown;
    } & Record<string, unknown>;

    // Read phase — readonly tx, free to await.
    let allPhotos: PhotoRow[] = [];
    try {
      const readTx = db.transaction('photos', 'readonly');
      allPhotos = (await readTx.objectStore('photos').getAll()) as PhotoRow[];
      await readTx.done;
    } catch (readErr) {
      console.warn('[OfflineAuth] Failed to read photos store for path migration:', readErr);
      return;
    }

    const prefix = `${oldUserId}/`;
    const toRewrite = allPhotos.filter(
      (p): p is PhotoRow & { photoUrl: string } => {
        // Only touch pending uploads. `uploaded` is the canonical flag
        // (indexed as `by-uploaded` in offline-storage).
        if (p?.uploaded) return false;
        return typeof p?.photoUrl === 'string' && p.photoUrl.startsWith(prefix);
      },
    );

    if (toRewrite.length === 0) {
      if (import.meta.env.DEV) {
        console.log('[OfflineAuth] No pending photo paths to migrate');
      }
      return;
    }

    // Write phase — fire all puts synchronously, then await tx.done.
    try {
      const writeTx = db.transaction('photos', 'readwrite');
      const writeStore = writeTx.objectStore('photos');
      const puts = toRewrite.map((photo) => {
        try {
          // N-G invariant: every photo write site MUST coerce `uploaded`
          // through toUploadedFlag so Safari/spec-strict IDB keeps the row
          // in the `by-uploaded` index. A legacy boolean `uploaded: false`
          // would otherwise round-trip back into IDB here and the next
          // `getUnuploadedPhotos()` would silently miss this row.
          const rewritten = {
            ...photo,
            photoUrl: `${newUserId}/${photo.photoUrl.slice(prefix.length)}`,
            uploaded: toUploadedFlag(photo.uploaded),
          };
          return writeStore.put(rewritten);
        } catch (rowErr) {
          console.warn('[OfflineAuth] Skipped photo during path migration:', photo?.id, rowErr);
          return Promise.resolve();
        }
      });
      await Promise.all(puts);
      await writeTx.done;
    } catch (writeErr) {
      console.warn('[OfflineAuth] Photo path migration write phase failed:', writeErr);
      return;
    }

    if (import.meta.env.DEV) {
      console.log(`[OfflineAuth] Migrated ${toRewrite.length} pending photo paths ${oldUserId} → ${newUserId}`);
    }
  } catch (error) {
    console.error('[OfflineAuth] migratePendingPhotoPaths failed:', error);
  }
}

/**
 * Hard sign-out cleanup (online sign-out path).
 * Wipes the synthetic session and the captured refresh token for the given user.
 */
export async function clearOfflineAuth(email?: string): Promise<void> {
  clearSyntheticSession();
  try {
    const db = await getAuthDB();
    // Always clear the legacy XOR password store.
    await db.clear('pending_credentials');
    if (email) {
      await db.delete('offline_auth', email.toLowerCase().trim());
    }
  } catch (error) {
    console.warn('[OfflineAuth] Failed to clear offline auth:', error);
  }
}

// ==================== H11: Soft offline sign-out + queued cleanup ====================

interface PendingOfflineSignout {
  userId: string;
  email?: string;
  queuedAt: number;
}

/**
 * Soft sign-out used while OFFLINE. Clears the synthetic session and in-memory
 * caches so the UI returns to the sign-in screen, but keeps the captured
 * refresh token so the user can sign back in offline immediately.
 *
 * A flag is queued so the next online auth check completes the cleanup
 * (revoking the refresh token server-side).
 */
export function queueOfflineSignout(userId: string, email?: string): void {
  const payload: PendingOfflineSignout = { userId, email, queuedAt: Date.now() };
  // Lazy import to avoid pulling notification-center into the auth boot path.
  import('./safe-local-storage').then(({ safeSetItem }) => {
    safeSetItem(PENDING_OFFLINE_SIGNOUT_KEY, JSON.stringify(payload), {
      scope: 'offline-auth.queueSignout',
      critical: false,
    });
  }).catch(() => {
    // Last-ditch direct write if helper import fails
    try {
      localStorage.setItem(PENDING_OFFLINE_SIGNOUT_KEY, JSON.stringify(payload));
    } catch { /* swallow */ }
  });
}

export function getPendingOfflineSignout(): PendingOfflineSignout | null {
  try {
    const raw = localStorage.getItem(PENDING_OFFLINE_SIGNOUT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingOfflineSignout;
  } catch {
    return null;
  }
}

export function clearPendingOfflineSignout(): void {
  localStorage.removeItem(PENDING_OFFLINE_SIGNOUT_KEY);
}

/**
 * Run the queued offline-signout cleanup if it matches the currently-active
 * user (or there is no active user). If a different user is now signed in, we
 * drop the queued cleanup so we don't touch their state.
 *
 * Safe to call repeatedly — it's a no-op when there is no pending cleanup.
 */
export async function processQueuedSignout(activeUserId?: string | null): Promise<void> {
  const pending = getPendingOfflineSignout();
  if (!pending) return;
  if (!navigator.onLine) return;

  // If a different user is now signed in, abandon the queued cleanup.
  if (activeUserId && activeUserId !== pending.userId) {
    clearPendingOfflineSignout();
    return;
  }

  try {
    // Best-effort: revoke the refresh token server-side if a Supabase session is present.
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      // Non-critical — we may not have a real session
      if (import.meta.env.DEV) {
        console.warn('[OfflineAuth] processQueuedSignout: supabase.signOut failed:', e);
      }
    }

    if (pending.email) {
      await deleteOfflineAuthEntry(pending.email);
    }

    clearSyntheticSession();
    clearPendingOfflineSignout();

    if (import.meta.env.DEV) {
      console.log('[OfflineAuth] Queued offline sign-out cleanup completed for', pending.userId);
    }
  } catch (error) {
    console.warn('[OfflineAuth] processQueuedSignout failed:', error);
  }
}

// ==================== Boot migration ====================

/**
 * One-time migration: wipe the legacy XOR password blob.
 * Idempotent — safe to call on every boot.
 */
export async function wipeLegacyPasswordStore(): Promise<void> {
  try {
    const db = await getAuthDB();
    await db.clear('pending_credentials');
    if (import.meta.env.DEV) {
      console.log('[OfflineAuth] Legacy XOR password store wiped');
    }
  } catch (error) {
    console.warn('[OfflineAuth] Failed to wipe legacy password store:', error);
  }
}
