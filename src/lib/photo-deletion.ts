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
  tableName?: "inspection_photos" | "training_photos" | "daily_assessment_photos";
  foreignKeyColumn?: string;
}

export interface DeletePhotoResult {
  dbResult: { ok: boolean; matched: number; error?: string };
  idbRemoved: number;
  tombstoned: boolean;
}

export async function deletePhotoEverywhere(args: DeletePhotoArgs): Promise<DeletePhotoResult> {
  const {
    inspectionId,
    section,
    rawStoragePath,
    dbPhotoId,
    tableName = "inspection_photos",
    foreignKeyColumn = "inspection_id",
  } = args;

  if (isPhotoTraceEnabled()) {
    photoTrace("deletePhoto.requested", {
      inspectionId,
      section,
      rawStoragePath,
      dbPhotoId,
      tableName,
    });
  }

  const now = new Date();
  const deletedAt = now.toISOString();
  const retentionUntil = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Soft-delete DB row (best-effort)
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

  // 2. Tombstone (so merge cannot resurrect)
  let tombstoned = false;
  if (rawStoragePath) {
    addPhotoTombstone(inspectionId, section, rawStoragePath);
    tombstoned = true;
  }

  // 3. Remove matching IDB photos (by id OR raw storage path)
  let idbRemoved = 0;
  try {
    const offline = await getOfflinePhotos(inspectionId);
    const matches = (offline || []).filter((p: any) => {
      if (p?.section !== section) return false;
      if (dbPhotoId && p.id === dbPhotoId) return true;
      if (rawStoragePath && p.photoUrl === rawStoragePath) return true;
      return false;
    });
    for (const m of matches) {
      try {
        await deleteOfflinePhoto((m as any).id);
        idbRemoved++;
      } catch {
        /* swallow per-row failures */
      }
    }
  } catch {
    /* ignore */
  }

  if (isPhotoTraceEnabled()) {
    photoTrace("deletePhoto.result", {
      inspectionId,
      section,
      rawStoragePath,
      dbPhotoId,
      dbResult,
      idbRemoved,
      tombstoned,
    });
  }

  return { dbResult, idbRemoved, tombstoned };
}
