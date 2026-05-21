/**
 * Guest Claim — migrate guest-owned local work to a real signed-in user.
 *
 * When a brand-new device user works as Guest (offline-only, identity
 * `guest-<uuid>`) and then later signs into a real account online, we
 * need to transfer their unsynced inspections / trainings / daily
 * assessments / photos to the new user so the normal sync pipeline can
 * upload them.
 *
 * Hard rules
 * ----------
 *   1. Idempotent — calling claim twice (mid-claim reload, retry button)
 *      must NEVER duplicate reports, child rows, or photos. Each record
 *      is marked with `_claimedFromGuestId` after migration; the second
 *      pass skips already-claimed records.
 *   2. Never destroy guest data on failure. The guest session is cleared
 *      only after a successful end-to-end pass.
 *   3. Per-record try/catch — one bad row never blocks the rest.
 *   4. Network-free — claim only rewrites local IDB. The standard sync
 *      pipeline picks the rewritten rows up on the next drain.
 *
 * Telemetry events (dispatched on `window` via CustomEvent so tests and
 * the Sync Terminal can observe progress):
 *   guest.claim.available
 *   guest.claim.start
 *   guest.claim.report-migrated   (per parent report)
 *   guest.claim.photo-migrated    (per photo)
 *   guest.claim.complete
 *   guest.claim.failed
 *   guest.claim.retry-available
 */

import { getDB, IDB_DB_NAME } from "./offline-storage";
import { clearGuestSession, isGuestUserId } from "./guest-session";

const PARENT_STORES = ["inspections", "trainings", "daily_assessments"] as const;
const CHILD_STORES = [
  "inspection_systems",
  "inspection_ziplines",
  "inspection_equipment",
  "inspection_standards",
  "inspection_summary",
  "daily_assessment_beginning_of_day",
  "daily_assessment_end_of_day",
  "daily_assessment_operating_systems",
  "daily_assessment_equipment_checks",
] as const;
const PHOTO_STORE = "photos";

type ParentStoreName = (typeof PARENT_STORES)[number];

export interface GuestClaimCounts {
  inspections: number;
  trainings: number;
  daily_assessments: number;
  photos: number;
  childRows: number;
  total: number;
}

export interface GuestClaimResult {
  ok: boolean;
  counts: GuestClaimCounts;
  errors: Array<{ store: string; recordId?: string; message: string }>;
}

function emit(eventName: string, detail?: Record<string, unknown>): void {
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: detail ?? {} }));
  } catch {
    /* non-browser test env */
  }
}

function asGuestOwned(row: unknown): row is Record<string, unknown> & { inspector_id?: string } {
  if (!row || typeof row !== "object") return false;
  const inspectorId = (row as { inspector_id?: unknown }).inspector_id;
  return typeof inspectorId === "string" && isGuestUserId(inspectorId);
}

function alreadyClaimed(row: Record<string, unknown>): boolean {
  return typeof row._claimedFromGuestId === "string";
}

/**
 * Count guest-owned records across all stores. Useful for the
 * "Sign in online to claim your guest work" prompt detection.
 */
export async function detectGuestDataForClaim(): Promise<GuestClaimCounts> {
  const counts: GuestClaimCounts = {
    inspections: 0,
    trainings: 0,
    daily_assessments: 0,
    photos: 0,
    childRows: 0,
    total: 0,
  };
  try {
    const db = await getDB();
    if (!db) return counts;
    for (const store of PARENT_STORES) {
      try {
        if (!db.objectStoreNames.contains(store)) continue;
        const rows = (await db.getAll(store)) as unknown[];
        const owned = rows.filter(asGuestOwned).filter((r) => !alreadyClaimed(r));
        counts[store] = owned.length;
      } catch {
        /* per-store best-effort */
      }
    }
    for (const store of CHILD_STORES) {
      try {
        if (!db.objectStoreNames.contains(store)) continue;
        const rows = (await db.getAll(store)) as unknown[];
        const owned = rows.filter(asGuestOwned).filter((r) => !alreadyClaimed(r));
        counts.childRows += owned.length;
      } catch {
        /* noop */
      }
    }
    try {
      if (db.objectStoreNames.contains(PHOTO_STORE)) {
        const rows = (await db.getAll(PHOTO_STORE)) as unknown[];
        const owned = rows.filter((r) => {
          if (!r || typeof r !== "object") return false;
          const uid = (r as { user_id?: unknown; uploaded_by?: unknown; inspector_id?: unknown });
          const candidate =
            (typeof uid.user_id === "string" && uid.user_id) ||
            (typeof uid.uploaded_by === "string" && uid.uploaded_by) ||
            (typeof uid.inspector_id === "string" && uid.inspector_id) ||
            "";
          return isGuestUserId(candidate) && !alreadyClaimed(r as Record<string, unknown>);
        });
        counts.photos = owned.length;
      }
    } catch {
      /* noop */
    }
  } catch {
    /* DB unavailable — return zeros */
  }
  counts.total =
    counts.inspections +
    counts.trainings +
    counts.daily_assessments +
    counts.photos +
    counts.childRows;
  if (counts.total > 0) emit("guest.claim.available", { counts });
  return counts;
}

async function rewriteOwnerInStore(
  storeName: string,
  newUserId: string,
  options: { isPhoto?: boolean } = {},
): Promise<{ migrated: number; errors: Array<{ recordId?: string; message: string }> }> {
  const errors: Array<{ recordId?: string; message: string }> = [];
  let migrated = 0;
  try {
    const db = await getDB();
    if (!db) return { migrated, errors };
    if (!db.objectStoreNames.contains(storeName)) return { migrated, errors };

    // Read all rows first (small batch — single user's guest work).
    const rows = (await db.getAll(storeName)) as Array<Record<string, unknown>>;
    const targets = rows.filter((r) => {
      if (!r || alreadyClaimed(r)) return false;
      if (options.isPhoto) {
        const uid =
          (typeof r.user_id === "string" && r.user_id) ||
          (typeof r.uploaded_by === "string" && r.uploaded_by) ||
          (typeof r.inspector_id === "string" && r.inspector_id) ||
          "";
        return isGuestUserId(String(uid));
      }
      return asGuestOwned(r);
    });

    for (const row of targets) {
      const recordId = typeof row.id === "string" ? row.id : undefined;
      try {
        const prevGuestId =
          (typeof row.inspector_id === "string" && row.inspector_id) ||
          (typeof row.user_id === "string" && row.user_id) ||
          (typeof row.uploaded_by === "string" && row.uploaded_by) ||
          "unknown-guest";

        const updated: Record<string, unknown> = {
          ...row,
          _claimedFromGuestId: prevGuestId,
          _claimedAt: new Date().toISOString(),
          // Force a re-sync of the rewritten record on the next drain.
          dirty: true,
          synced_at: null,
          updated_at: new Date().toISOString(),
        };
        if (typeof row.inspector_id === "string") {
          updated.inspector_id = newUserId;
        }
        if (options.isPhoto) {
          if (typeof row.user_id === "string") updated.user_id = newUserId;
          if (typeof row.uploaded_by === "string") updated.uploaded_by = newUserId;
          if (typeof row.inspector_id === "string") {
            updated.inspector_id = newUserId;
          }
          // photos.uploaded must remain 0|1 (numeric IDB index contract).
          if (typeof row.uploaded === "boolean") {
            updated.uploaded = row.uploaded ? 1 : 0;
          }
        }
        await db.put(storeName, updated);
        migrated += 1;
        if (options.isPhoto) {
          emit("guest.claim.photo-migrated", { storeName, recordId });
        } else if ((PARENT_STORES as readonly string[]).includes(storeName)) {
          emit("guest.claim.report-migrated", { storeName, recordId });
        }
      } catch (err) {
        errors.push({
          recordId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    errors.push({
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return { migrated, errors };
}

/**
 * Migrate all guest-owned local records to `newUserId`. Idempotent.
 * Never throws. Returns a result describing what migrated and what
 * failed. On full success, clears the guest session.
 */
export async function claimGuestData(newUserId: string): Promise<GuestClaimResult> {
  const result: GuestClaimResult = {
    ok: false,
    counts: {
      inspections: 0,
      trainings: 0,
      daily_assessments: 0,
      photos: 0,
      childRows: 0,
      total: 0,
    },
    errors: [],
  };

  if (!newUserId || isGuestUserId(newUserId)) {
    result.errors.push({
      store: "validation",
      message: "claimGuestData requires a non-guest userId",
    });
    emit("guest.claim.failed", { reason: "invalid-user", errors: result.errors });
    return result;
  }

  emit("guest.claim.start", { newUserId });

  try {
    for (const store of PARENT_STORES) {
      const { migrated, errors } = await rewriteOwnerInStore(store, newUserId);
      result.counts[store as ParentStoreName] = migrated;
      errors.forEach((e) => result.errors.push({ store, ...e }));
    }
    for (const store of CHILD_STORES) {
      const { migrated, errors } = await rewriteOwnerInStore(store, newUserId);
      result.counts.childRows += migrated;
      errors.forEach((e) => result.errors.push({ store, ...e }));
    }
    const { migrated: photoMigrated, errors: photoErrors } =
      await rewriteOwnerInStore(PHOTO_STORE, newUserId, { isPhoto: true });
    result.counts.photos = photoMigrated;
    photoErrors.forEach((e) => result.errors.push({ store: PHOTO_STORE, ...e }));

    result.counts.total =
      result.counts.inspections +
      result.counts.trainings +
      result.counts.daily_assessments +
      result.counts.photos +
      result.counts.childRows;

    result.ok = result.errors.length === 0;

    if (result.ok) {
      // Only clear guest identity on a fully clean pass. Failed pass keeps
      // the guest session so the user can retry without losing identity
      // tied to the still-guest-owned records.
      clearGuestSession();
      emit("guest.claim.complete", { counts: result.counts });
    } else {
      emit("guest.claim.failed", {
        counts: result.counts,
        errors: result.errors,
      });
      emit("guest.claim.retry-available", { errorCount: result.errors.length });
    }
  } catch (err) {
    result.errors.push({
      store: "coordinator",
      message: err instanceof Error ? err.message : String(err),
    });
    emit("guest.claim.failed", {
      counts: result.counts,
      errors: result.errors,
    });
    emit("guest.claim.retry-available", { errorCount: result.errors.length });
  }

  return result;
}

export const __test_only__ = {
  PARENT_STORES,
  CHILD_STORES,
  PHOTO_STORE,
  IDB_DB_NAME,
};
