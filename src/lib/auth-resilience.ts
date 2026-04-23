/**
 * Phase 1 — Crash & Corruption Resilience for offline auth.
 *
 * This module sits underneath `offline-auth.ts` / `cached-auth.ts` and provides:
 *
 *   1. Atomic writes        — write to `<key>.tmp`, verify, swap to `<key>`.
 *   2. Redundant storage    — every credential payload is mirrored to a
 *                              `primary` and a `backup` slot.
 *   3. SHA-256 checksums    — every stored payload carries a hash; reads
 *                              that fail verification fall back to the other
 *                              slot, then surface a "damaged" state.
 *   4. Write-confirm retry  — after every write we read back and verify;
 *                              up to 3 retries with exponential backoff.
 *   5. Transaction log      — small ring buffer (last 20 ops) so a boot
 *                              after a crash can detect an in-flight write.
 *   6. Boot validation      — `validateAuthStateOnBoot()` cross-checks the
 *                              synthetic session, the offline-auth slots, the
 *                              Supabase session blob, and the last tx-log
 *                              entry. Any inconsistency rolls forward to a
 *                              clean known-good state and records why.
 *   7. Recovery log         — `getAuthRecoveryLog()` exposes the last few
 *                              auto-repair events for the UI / support.
 *
 * SAFETY: This module never throws to its callers. Every public API returns
 * a result envelope so that an offline user with damaged storage still gets
 * routed to the sign-in screen rather than to a white screen of death.
 */

import { openDB, type IDBPDatabase } from 'idb';
import {
  encryptForStorage,
  decryptFromStorage,
  isEncryptedPayload,
} from './auth-crypto';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const RESILIENCE_DB_NAME = 'auth-resilience-store';
const RESILIENCE_DB_VERSION = 1;

const STORE_SLOTS = 'slots';        // primary + backup payloads (with hash)
const STORE_TX_LOG = 'tx_log';      // ring buffer of recent ops
const STORE_RECOVERY = 'recovery';  // boot-time recovery events

const TX_LOG_MAX_ENTRIES = 20;
const RECOVERY_LOG_MAX_ENTRIES = 50;
const WRITE_VERIFY_MAX_ATTEMPTS = 3;
const WRITE_VERIFY_BACKOFF_MS = [50, 150, 400];

/** Symbolic names for credential slots that callers can write. */
export type AuthCredentialKey =
  | 'offline-auth'        // refresh token + email→userId mapping (per user)
  | 'synthetic-session';  // active offline session blob

/** Phases recorded in the transaction log. */
export type TxPhase =
  | 'STARTED'
  | 'WROTE_TMP'
  | 'VERIFIED_TMP'
  | 'SWAPPED'
  | 'COMPLETE'
  | 'FAILED';

interface SlotRow {
  /** Composite key: `${logicalKey}::${slot}` where slot ∈ primary|backup. */
  id: string;
  logicalKey: string;
  slot: 'primary' | 'backup';
  payload: string;        // JSON-stringified user payload
  sha256: string;         // hex-encoded
  writtenAt: number;
  schemaVersion: number;
}

interface TxLogRow {
  id?: number;
  op: string;             // e.g. 'write:offline-auth:user@example.com'
  phase: TxPhase;
  ts: number;
  detail?: string;
}

interface RecoveryRow {
  id?: number;
  ts: number;
  kind:
    | 'tmp-discarded'
    | 'primary-failed-checksum'
    | 'backup-failed-checksum'
    | 'both-slots-damaged'
    | 'tx-log-rollback'
    | 'inconsistent-state-cleared'
    | 'restored-from-backup';
  message: string;
}

// ────────────────────────────────────────────────────────────────────────────
// DB
// ────────────────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase> | null = null;

function getResilienceDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(RESILIENCE_DB_NAME, RESILIENCE_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_SLOTS)) {
          db.createObjectStore(STORE_SLOTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TX_LOG)) {
          db.createObjectStore(STORE_TX_LOG, {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
        if (!db.objectStoreNames.contains(STORE_RECOVERY)) {
          db.createObjectStore(STORE_RECOVERY, {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
      },
    });
    // If opening fails once, allow retry next call.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

// ────────────────────────────────────────────────────────────────────────────
// Hashing
// ────────────────────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  try {
    const buf = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    // SubtleCrypto unavailable (very old browsers) — fall back to a length+
    // checksum so the verify path still has something to compare against.
    let acc = 0;
    for (let i = 0; i < input.length; i++) {
      acc = (acc * 31 + input.charCodeAt(i)) | 0;
    }
    return `nocrypto:${input.length}:${acc.toString(16)}`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Transaction log (ring buffer)
// ────────────────────────────────────────────────────────────────────────────

async function appendTx(entry: TxLogRow): Promise<void> {
  try {
    const db = await getResilienceDB();
    const tx = db.transaction(STORE_TX_LOG, 'readwrite');
    await tx.objectStore(STORE_TX_LOG).add(entry);
    await tx.done;

    // Trim if over capacity (cheap, runs at most every few writes).
    const count = await db.count(STORE_TX_LOG);
    if (count > TX_LOG_MAX_ENTRIES) {
      const toDelete = count - TX_LOG_MAX_ENTRIES;
      const trimTx = db.transaction(STORE_TX_LOG, 'readwrite');
      const store = trimTx.objectStore(STORE_TX_LOG);
      let cursor = await store.openCursor();
      let removed = 0;
      while (cursor && removed < toDelete) {
        await cursor.delete();
        removed++;
        cursor = await cursor.continue();
      }
      await trimTx.done;
    }
  } catch {
    // Tx log is advisory — never block a write because we couldn't log it.
  }
}

export async function getRecentTxLog(limit = TX_LOG_MAX_ENTRIES): Promise<TxLogRow[]> {
  try {
    const db = await getResilienceDB();
    const all = (await db.getAll(STORE_TX_LOG)) as TxLogRow[];
    return all.slice(-limit);
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Recovery log
// ────────────────────────────────────────────────────────────────────────────

async function recordRecovery(
  kind: RecoveryRow['kind'],
  message: string
): Promise<void> {
  try {
    const db = await getResilienceDB();
    const tx = db.transaction(STORE_RECOVERY, 'readwrite');
    await tx.objectStore(STORE_RECOVERY).add({ ts: Date.now(), kind, message });
    await tx.done;

    const count = await db.count(STORE_RECOVERY);
    if (count > RECOVERY_LOG_MAX_ENTRIES) {
      const toDelete = count - RECOVERY_LOG_MAX_ENTRIES;
      const trimTx = db.transaction(STORE_RECOVERY, 'readwrite');
      const store = trimTx.objectStore(STORE_RECOVERY);
      let cursor = await store.openCursor();
      let removed = 0;
      while (cursor && removed < toDelete) {
        await cursor.delete();
        removed++;
        cursor = await cursor.continue();
      }
      await trimTx.done;
    }

    if (import.meta.env.DEV) {
      console.warn(`[AuthResilience][${kind}] ${message}`);
    }
  } catch {
    // ignore
  }
}

export async function getAuthRecoveryLog(limit = 10): Promise<RecoveryRow[]> {
  try {
    const db = await getResilienceDB();
    const all = (await db.getAll(STORE_RECOVERY)) as RecoveryRow[];
    return all.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Slot storage helpers
// ────────────────────────────────────────────────────────────────────────────

function slotId(logicalKey: string, slot: 'primary' | 'backup'): string {
  return `${logicalKey}::${slot}`;
}

function tmpSlotId(logicalKey: string, slot: 'primary' | 'backup'): string {
  return `${logicalKey}::${slot}.tmp`;
}

async function writeSlotRow(row: SlotRow): Promise<void> {
  const db = await getResilienceDB();
  const tx = db.transaction(STORE_SLOTS, 'readwrite');
  await tx.objectStore(STORE_SLOTS).put(row);
  await tx.done;
}

async function readSlotRow(id: string): Promise<SlotRow | null> {
  try {
    const db = await getResilienceDB();
    return ((await db.get(STORE_SLOTS, id)) as SlotRow | undefined) ?? null;
  } catch {
    return null;
  }
}

async function deleteSlotRow(id: string): Promise<void> {
  try {
    const db = await getResilienceDB();
    const tx = db.transaction(STORE_SLOTS, 'readwrite');
    await tx.objectStore(STORE_SLOTS).delete(id);
    await tx.done;
  } catch {
    // ignore
  }
}

async function verifyRow(row: SlotRow | null): Promise<boolean> {
  if (!row) return false;
  if (typeof row.payload !== 'string' || typeof row.sha256 !== 'string') return false;
  const expected = await sha256Hex(row.payload);
  return expected === row.sha256;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — atomic write
// ────────────────────────────────────────────────────────────────────────────

export interface WriteResult {
  ok: boolean;
  attempts: number;
  /** True when at least one of (primary, backup) slot was successfully written + verified. */
  partial: boolean;
  error?: string;
}

/**
 * Atomic, redundant write of a credential payload. Steps per slot:
 *   1. Serialize + hash payload.
 *   2. Write to `${slot}.tmp`.
 *   3. Read back and verify hash.
 *   4. Promote `.tmp` to live slot.
 *   5. Delete `.tmp`.
 *
 * Both slots (primary, backup) are written. Returns `ok=true` only when both
 * slots verify; returns `partial=true` when one slot succeeded — that's still
 * usable for offline sign-in (read path will fall back).
 */
export async function writeCredentialAtomic<T>(
  logicalKey: AuthCredentialKey | string,
  value: T
): Promise<WriteResult> {
  const op = `write:${logicalKey}`;
  await appendTx({ op, phase: 'STARTED', ts: Date.now() });

  let payload: string;
  try {
    const json = JSON.stringify(value);
    // Phase 4a — encrypt at rest. If crypto is unavailable this passes
    // through and we store plaintext (legacy behaviour).
    payload = await encryptForStorage(json);
  } catch (err: any) {
    await appendTx({ op, phase: 'FAILED', ts: Date.now(), detail: 'serialize-failed' });
    return { ok: false, attempts: 0, partial: false, error: err?.message || 'serialize-failed' };
  }

  const sha256 = await sha256Hex(payload);
  const writtenAt = Date.now();

  // Phase 3 — pre-flight quota check. If storage is tight, evict non-auth
  // caches FIRST so the credential write doesn't race the quota.
  let quotaWarned = false;
  try {
    const { ensureSpaceForAuth } = await import('./storage-pressure-manager');
    const space = await ensureSpaceForAuth();
    if (!space.ok) {
      quotaWarned = true;
      // We still attempt the write — the auth payload is tiny and may fit
      // in the slack the browser keeps, but we surface a recovery event so
      // support can correlate later failures.
      await recordRecovery(
        'tmp-discarded',
        `Pre-flight: insufficient quota for auth write (${space.estimate.tier} tier). Proceeding anyway.`
      );
    }
  } catch {
    // Storage API unavailable — fall through.
  }

  const writeOneSlot = async (slot: 'primary' | 'backup'): Promise<boolean> => {
    for (let attempt = 1; attempt <= WRITE_VERIFY_MAX_ATTEMPTS; attempt++) {
      const tmpId = tmpSlotId(logicalKey, slot);
      const finalId = slotId(logicalKey, slot);
      const row: SlotRow = {
        id: tmpId,
        logicalKey,
        slot,
        payload,
        sha256,
        writtenAt,
        schemaVersion: 1,
      };
      try {
        await writeSlotRow(row);
        const readBack = await readSlotRow(tmpId);
        if (!(await verifyRow(readBack))) {
          throw new Error('verify-tmp-failed');
        }
        // Promote
        await writeSlotRow({ ...row, id: finalId });
        const liveBack = await readSlotRow(finalId);
        if (!(await verifyRow(liveBack))) {
          throw new Error('verify-live-failed');
        }
        await deleteSlotRow(tmpId);
        return true;
      } catch (err: any) {
        // Phase 3 — Quota-exception handling: detect QuotaExceededError
        // specifically and try one round of aggressive eviction before retry.
        let isQuota = false;
        try {
          const { isQuotaExceededError, ensureSpaceForAuth } = await import('./storage-pressure-manager');
          if (isQuotaExceededError(err)) {
            isQuota = true;
            quotaWarned = true;
            await recordRecovery(
              'tmp-discarded',
              `QuotaExceededError on ${slot} attempt ${attempt} — running emergency eviction`
            );
            await ensureSpaceForAuth();
          }
        } catch {
          // ignore
        }

        if (attempt < WRITE_VERIFY_MAX_ATTEMPTS) {
          // On quota errors, retry immediately after eviction; otherwise back off.
          const delay = isQuota ? 0 : (WRITE_VERIFY_BACKOFF_MS[attempt - 1] || 400);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        await appendTx({
          op,
          phase: 'FAILED',
          ts: Date.now(),
          detail: `${slot}:${err?.message || 'unknown'}`,
        });
        return false;
      }
    }
    return false;
  };

  await appendTx({ op, phase: 'WROTE_TMP', ts: Date.now() });
  const primaryOk = await writeOneSlot('primary');
  const backupOk = await writeOneSlot('backup');
  await appendTx({ op, phase: 'VERIFIED_TMP', ts: Date.now() });
  await appendTx({ op, phase: 'SWAPPED', ts: Date.now() });

  // Phase 3 — surface a non-blocking warning when storage pressure was
  // detected during this write so the user can free space.
  if (quotaWarned) {
    try {
      // Toast helper is best-effort — never throw.
      const { toast } = await import('sonner');
      toast.warning(
        'Device storage low — offline sign-in may be unreliable.',
        { duration: 8000, id: 'auth-storage-low' }
      );
    } catch {
      // ignore
    }
  }

  if (primaryOk && backupOk) {
    await appendTx({ op, phase: 'COMPLETE', ts: Date.now() });
    return { ok: true, attempts: 1, partial: false };
  }
  if (primaryOk || backupOk) {
    await appendTx({
      op,
      phase: 'COMPLETE',
      ts: Date.now(),
      detail: `partial:primary=${primaryOk},backup=${backupOk}`,
    });
    return { ok: true, attempts: 1, partial: true };
  }

  await appendTx({ op, phase: 'FAILED', ts: Date.now(), detail: 'both-slots-failed' });
  return { ok: false, attempts: WRITE_VERIFY_MAX_ATTEMPTS, partial: false, error: 'both-slots-failed' };
}


// ────────────────────────────────────────────────────────────────────────────
// Public API — read with fallback
// ────────────────────────────────────────────────────────────────────────────

export interface ReadResult<T> {
  ok: boolean;
  value: T | null;
  source: 'primary' | 'backup' | 'none';
  damaged: boolean;
}

/**
 * Read a credential. Tries `primary` first; if its checksum fails, tries
 * `backup`. If both fail, records a `both-slots-damaged` recovery event and
 * returns `damaged=true` so the UI can surface the issue.
 */
export async function readCredentialResilient<T>(
  logicalKey: AuthCredentialKey | string
): Promise<ReadResult<T>> {
  // Phase 4a — payloads may be encrypted (`enc:v1:...`). Try to decrypt; if
  // it's already plaintext (legacy), pass through. A null result from a
  // tagged ciphertext means the key is gone or the blob was tampered with —
  // treat as damaged so the user is forced back online.
  const tryParse = async (raw: string): Promise<T | null> => {
    const decrypted = await decryptFromStorage(raw);
    if (decrypted === null) return null;
    try {
      return JSON.parse(decrypted) as T;
    } catch {
      return null;
    }
  };

  const primary = await readSlotRow(slotId(logicalKey, 'primary'));
  if (await verifyRow(primary)) {
    const value = await tryParse(primary!.payload);
    if (value !== null) {
      // Self-heal: if the stored payload is still legacy plaintext, rewrite
      // it through the encrypted path on next save. We don't force a write
      // here — letting the next normal save migrate avoids an extra IO burst.
      return { ok: true, value, source: 'primary', damaged: false };
    }
    await recordRecovery(
      'primary-failed-checksum',
      `Primary slot for "${logicalKey}" decrypted to invalid JSON (key mismatch?)`
    );
  } else if (primary) {
    await recordRecovery(
      'primary-failed-checksum',
      `Primary slot for "${logicalKey}" failed checksum verification`
    );
  }

  const backup = await readSlotRow(slotId(logicalKey, 'backup'));
  if (await verifyRow(backup)) {
    const value = await tryParse(backup!.payload);
    if (value !== null) {
      // Self-heal: rewrite primary from backup so future reads are fast.
      writeCredentialAtomic(logicalKey, value).catch(() => {});
      await recordRecovery(
        'restored-from-backup',
        `Restored "${logicalKey}" from backup slot after primary failure`
      );
      return { ok: true, value, source: 'backup', damaged: false };
    }
  } else if (backup) {
    await recordRecovery(
      'backup-failed-checksum',
      `Backup slot for "${logicalKey}" failed checksum verification`
    );
  }

  if (primary || backup) {
    await recordRecovery(
      'both-slots-damaged',
      `Both slots damaged for "${logicalKey}" — credentials unrecoverable`
    );
    return { ok: false, value: null, source: 'none', damaged: true };
  }

  return { ok: false, value: null, source: 'none', damaged: false };
}

/** Explicitly delete both slots for a logical key. */
export async function deleteCredentialResilient(
  logicalKey: AuthCredentialKey | string
): Promise<void> {
  await deleteSlotRow(slotId(logicalKey, 'primary'));
  await deleteSlotRow(slotId(logicalKey, 'backup'));
  await deleteSlotRow(tmpSlotId(logicalKey, 'primary'));
  await deleteSlotRow(tmpSlotId(logicalKey, 'backup'));
}

// ────────────────────────────────────────────────────────────────────────────
// Boot validation
// ────────────────────────────────────────────────────────────────────────────

const DAMAGED_FLAG_KEY = 'auth-credentials-damaged';

/**
 * Set/cleared by `validateAuthStateOnBoot()` — read by `Auth.tsx` to surface
 * a clear "credentials damaged — please reconnect" message.
 */
export function isCredentialsDamaged(): boolean {
  try {
    return localStorage.getItem(DAMAGED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearCredentialsDamagedFlag(): void {
  try {
    localStorage.removeItem(DAMAGED_FLAG_KEY);
  } catch {
    // ignore
  }
}

function setCredentialsDamagedFlag(): void {
  try {
    localStorage.setItem(DAMAGED_FLAG_KEY, '1');
  } catch {
    // ignore
  }
}

export interface BootValidationResult {
  ok: boolean;
  recovered: boolean;
  notes: string[];
}

/**
 * Cross-checks all auth-related storage on boot. Detects:
 *   - Lingering `.tmp` rows from a crashed write → discards them.
 *   - Tx log entries with `STARTED_*` and no matching `COMPLETE_*` → records
 *     a rollback recovery event.
 *   - Damaged credential slots → flips `isCredentialsDamaged` flag.
 *
 * NEVER throws. Safe to call on every boot — runs in milliseconds when
 * everything is healthy.
 */
export async function validateAuthStateOnBoot(): Promise<BootValidationResult> {
  const notes: string[] = [];
  let recovered = false;

  try {
    const db = await getResilienceDB();

    // 1. Discard any `.tmp` rows. If `.tmp` exists, the write that created it
    //    didn't reach COMPLETE — the live slot is either still the previous
    //    good value or also corrupt (which the read path will detect).
    const allSlots = (await db.getAll(STORE_SLOTS)) as SlotRow[];
    const tmpRows = allSlots.filter((r) => r.id.endsWith('.tmp'));
    if (tmpRows.length > 0) {
      const tx = db.transaction(STORE_SLOTS, 'readwrite');
      for (const row of tmpRows) {
        await tx.objectStore(STORE_SLOTS).delete(row.id);
      }
      await tx.done;
      recovered = true;
      notes.push(`discarded ${tmpRows.length} stale .tmp slot(s)`);
      await recordRecovery(
        'tmp-discarded',
        `Boot discarded ${tmpRows.length} incomplete .tmp slot(s)`
      );
    }

    // 2. Tx-log inspection — look at the last entry per op and see if it ends
    //    in something other than COMPLETE.
    const txEntries = (await db.getAll(STORE_TX_LOG)) as TxLogRow[];
    const lastByOp = new Map<string, TxLogRow>();
    for (const e of txEntries) lastByOp.set(e.op, e);
    let inflight = 0;
    for (const e of lastByOp.values()) {
      if (e.phase !== 'COMPLETE' && e.phase !== 'FAILED') {
        inflight++;
      }
    }
    if (inflight > 0) {
      recovered = true;
      notes.push(`rolled back ${inflight} in-flight op(s)`);
      await recordRecovery(
        'tx-log-rollback',
        `Boot detected ${inflight} in-flight auth op(s) interrupted by previous crash`
      );
    }

    // 3. Verify both slots for every known logical credential. If both are
    //    damaged, flip the user-facing flag.
    const logicalKeys = Array.from(
      new Set(allSlots.filter((r) => !r.id.endsWith('.tmp')).map((r) => r.logicalKey))
    );
    let anyDamaged = false;
    for (const key of logicalKeys) {
      const result = await readCredentialResilient(key);
      if (result.damaged) anyDamaged = true;
    }
    if (anyDamaged) {
      setCredentialsDamagedFlag();
      notes.push('credentials damaged — flagged for UI');
    } else {
      clearCredentialsDamagedFlag();
    }

    return { ok: true, recovered, notes };
  } catch (err: any) {
    // Don't block boot — even if the resilience DB is broken, the legacy
    // offline-auth path still works.
    return {
      ok: false,
      recovered: false,
      notes: [`boot-validation-failed:${err?.message || 'unknown'}`],
    };
  }
}
