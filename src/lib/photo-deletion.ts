/**
 * Shared photo deletion helper — converges the row-thumbnail Remove and the
 * bottom-gallery delete through one path so they cannot diverge and cannot
 * resurrect a deleted photo from IndexedDB.
 *
 * Steps (best-effort, each independent of the others):
 *   1. Soft-delete the matching active `inspection_photos` row (deleted_at +
 *      retention_until), filtered by `.is('deleted_at', null)` so already-
 *      deleted rows are skipped.
 *   2. Add a local tombstone keyed by inspection+section+rawStoragePath so the
 *      offline-first merge in PhotoGallery cannot re-show the photo even
 *      before the DB delete propagates / when offline.
 *   3. Remove every IndexedDB `photos` row whose id OR raw photoUrl matches.
 *
 * Tombstones expire after 24h (long after sync would have settled) and live
 * in localStorage so they survive route changes within the session.
 */

import { supabase } from "@/integrations/supabase/client";
import { getOfflinePhotos, deleteOfflinePhoto } from "@/lib/offline-storage";
import { photoTrace, isPhotoTraceEnabled } from "@/lib/photo-trace";
import { removePhotoReceipts } from "@/lib/photo-receipts";
import { getOfflineUserId } from "@/lib/cached-auth";
import { recordSaveWithoutIdentity } from "@/lib/offline-readiness";

const TOMBSTONE_KEY = "photo_tombstones_v1";
const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;

type TombstoneMap = Record<string, number>;

function readTombstones(): TombstoneMap {
  try {
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem(TOMBSTONE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TombstoneMap;
    const now = Date.now();
    const pruned: TombstoneMap = {};
    for (const [k, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && now - ts < TOMBSTONE_TTL_MS) pruned[k] = ts;
    }
    return pruned;
  } catch {
    return {};
  }
}

function writeTombstones(map: TombstoneMap) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(map));
    }
  } catch {
    /* ignore quota / disabled storage */
  }
}

function tombstoneKey(inspectionId: string, section: string, rawPath: string) {
  return `${inspectionId}|${section}|${rawPath}`;
}

export function addPhotoTombstone(
  inspectionId: string,
  section: string,
  rawPath: string | null | undefined
) {
  if (!rawPath) return;
  const map = readTombstones();
  map[tombstoneKey(inspectionId, section, rawPath)] = Date.now();
  writeTombstones(map);
}

export function isPhotoTombstoned(
  inspectionId: string,
  section: string,
  rawPath: string | null | undefined
): boolean {
  if (!rawPath) return false;
  const map = readTombstones();
  return Boolean(map[tombstoneKey(inspectionId, section, rawPath)]);
}

export interface DeletePhotoArgs {
  inspectionId: string;
  section: string;
  /** photo_url stored in the DB row (raw storage path, e.g. "items/abc.jpg" or "pending/..."). */
  rawStoragePath?: string | null;
  /** inspection_photos row id, when known (from the gallery card). */
  dbPhotoId?: string | null;
  /**
   * Optional item scope. When provided, ALSO soft-delete + tombstone every
   * active DB row for this inspection whose `photo_url` matches
   * `%items/${itemIdScope}-%`. This covers the row/lightbox-delete case
   * where the form row's `photoUrl` (passed as `rawStoragePath`) is the
   * placeholder `pending/...` path but the actual gallery DB row was
   * written under the post-upload `${userId}/${inspectionId}/items/${itemId}-...jpg`
   * path. The two paths differ but both belong to the same item, so a
   * plain `.eq('photo_url', rawStoragePath)` misses the real row and the
   * bottom gallery keeps the photo after refresh.
   */
  itemIdScope?: string | null;
  tableName?: "inspection_photos" | "training_photos" | "daily_assessment_photos" | "jcf_photos";
  foreignKeyColumn?: string;
}

export interface DeletePhotoResult {
  dbResult: { ok: boolean; matched: number; error?: string };
  idbRemoved: number;
  tombstoned: boolean;
  scopedMatchedPaths?: string[];
}

export async function deletePhotoEverywhere(args: DeletePhotoArgs): Promise<DeletePhotoResult> {
  const {
    inspectionId,
    section,
    rawStoragePath,
    dbPhotoId,
    itemIdScope,
    tableName = "inspection_photos",
    foreignKeyColumn = "inspection_id",
  } = args;

  if (isPhotoTraceEnabled()) {
    photoTrace("deletePhoto.requested", {
      inspectionId,
      section,
      rawStoragePath,
      dbPhotoId,
      itemIdScope,
      tableName,
    });
  }

  // Phase 2 telemetry — record (but don't block) deletes that proceed
  // without identity. Local tombstone + IDB removal still run; this just
  // surfaces the case so we can quantify silent paths.
  try {
    if (!getOfflineUserId()) {
      recordSaveWithoutIdentity({
        op: "photo-delete",
        reportId: inspectionId,
        online: typeof navigator !== "undefined" ? navigator.onLine : null,
      });
    }
  } catch {
    // never block
  }

  const now = new Date();
  const deletedAt = now.toISOString();
  const retentionUntil = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Soft-delete DB row by exact id / path (best-effort)
  let dbResult: DeletePhotoResult["dbResult"] = { ok: true, matched: 0 };
  try {
    if (dbPhotoId || rawStoragePath) {
      let q: any = (supabase.from(tableName) as any)
        .update({ deleted_at: deletedAt, retention_until: retentionUntil })
        .eq(foreignKeyColumn, inspectionId)
        .is("deleted_at", null);
      if (dbPhotoId) q = q.eq("id", dbPhotoId);
      else if (rawStoragePath) q = q.eq("photo_url", rawStoragePath);
      const { data, error } = await q.select("id");
      if (error) dbResult = { ok: false, matched: 0, error: error.message };
      else dbResult = { ok: true, matched: (data || []).length };
    }
  } catch (e: any) {
    dbResult = { ok: false, matched: 0, error: e?.message ?? String(e) };
  }

  // 1b. Item-scoped soft-delete + tombstone fallback. Catches the
  //     form-photoUrl-vs-DB-photo_url divergence (placeholder vs real path).
  const scopedMatchedPaths: string[] = [];
  if (itemIdScope) {
    try {
      const pattern = `%items/${itemIdScope}-%`;
      const { data, error } = await (supabase.from(tableName) as any)
        .update({ deleted_at: deletedAt, retention_until: retentionUntil })
        .eq(foreignKeyColumn, inspectionId)
        .is("deleted_at", null)
        .like("photo_url", pattern)
        .select("id, photo_url");
      if (!error && Array.isArray(data)) {
        for (const row of data) {
          const p = (row as any).photo_url as string | undefined;
          if (p) {
            scopedMatchedPaths.push(p);
            addPhotoTombstone(inspectionId, section, p);
          }
        }
        dbResult = {
          ok: dbResult.ok,
          matched: dbResult.matched + data.length,
          error: dbResult.error,
        };
      } else if (error && !dbResult.error) {
        dbResult = { ...dbResult, ok: false, error: error.message };
      }
    } catch (e: any) {
      if (!dbResult.error) dbResult = { ...dbResult, ok: false, error: e?.message ?? String(e) };
    }
  }

  // 2. Tombstone (so merge cannot resurrect)
  let tombstoned = false;
  if (rawStoragePath) {
    addPhotoTombstone(inspectionId, section, rawStoragePath);
    tombstoned = true;
  }
  if (scopedMatchedPaths.length > 0) tombstoned = true;

  // 3. Remove matching IDB photos (by id OR raw storage path OR scoped paths)
  let idbRemoved = 0;
  try {
    const offline = await getOfflinePhotos(inspectionId);
    const scopedSet = new Set(scopedMatchedPaths);
    const matches = (offline || []).filter((p: any) => {
      if (p?.section !== section) return false;
      if (dbPhotoId && p.id === dbPhotoId) return true;
      if (rawStoragePath && p.photoUrl === rawStoragePath) return true;
      if (p.photoUrl && scopedSet.has(p.photoUrl)) return true;
      if (
        itemIdScope &&
        typeof p.photoUrl === "string" &&
        p.photoUrl.includes(`items/${itemIdScope}-`)
      ) {
        return true;
      }
      return false;
    });
    const removedReceiptIds: string[] = [];
    for (const m of matches) {
      try {
        await deleteOfflinePhoto((m as any).id);
        idbRemoved++;
        removedReceiptIds.push((m as any).id);
      } catch {
        /* swallow per-row failures */
      }
    }
    if (dbPhotoId) removedReceiptIds.push(dbPhotoId);
    // Clear photo receipts so an intentionally-deleted photo cannot be
    // re-counted by the "lost from local storage" warning in PhotoGallery.
    try { removePhotoReceipts(removedReceiptIds); } catch { /* ignore */ }
  } catch {
    /* ignore */
  }

  if (isPhotoTraceEnabled()) {
    photoTrace("deletePhoto.result", {
      inspectionId,
      section,
      rawStoragePath,
      dbPhotoId,
      itemIdScope,
      dbResult,
      idbRemoved,
      tombstoned,
      scopedMatchedPaths,
    });
  }

  return { dbResult, idbRemoved, tombstoned, scopedMatchedPaths };
}
