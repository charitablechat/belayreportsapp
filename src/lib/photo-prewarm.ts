/**
 * Photo pre-warm (Phase 2 E).
 *
 * Walks `inspection_photos` rows for reports active in the last 30 days
 * (plus a caller-provided "currently open report" id) and asks the
 * browser to GET each photo URL so the existing HTTP cache / service
 * worker picks them up for offline viewing.
 *
 * Bounded:
 *   - Up to 120 photos per run.
 *   - Aborts if storage pressure tier ≥ 2 (HIGH/CRITICAL).
 *   - Never touches local `photos` rows with `uploaded === 0`
 *     (unsynced — read nothing, write nothing).
 *   - Records summary into sessionStorage for the diagnostics card.
 */

import { supabase } from "@/integrations/supabase/client";
import { getStorageEstimate } from "@/lib/storage-pressure-manager";

const RESULT_KEY = "photo-prewarm.results";

export interface PhotoPrewarmResult {
  attempted: number;
  ok: number;
  failed: number;
  skippedDueToPressure: boolean;
  ranAt: number;
}

function writeResult(r: PhotoPrewarmResult) {
  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(r));
  } catch {
    // ignore
  }
}

export function getPhotoPrewarmResult(): PhotoPrewarmResult | null {
  try {
    const raw = sessionStorage.getItem(RESULT_KEY);
    return raw ? (JSON.parse(raw) as PhotoPrewarmResult) : null;
  } catch {
    return null;
  }
}

export async function prewarmActiveReportPhotos(
  opts: { openReportId?: string; maxPhotos?: number } = {},
): Promise<PhotoPrewarmResult> {
  const result: PhotoPrewarmResult = {
    attempted: 0,
    ok: 0,
    failed: 0,
    skippedDueToPressure: false,
    ranAt: Date.now(),
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    writeResult(result);
    return result;
  }

  // Respect storage pressure.
  try {
    const est = await getStorageEstimate();
    if (est && est.tier >= 2) {
      result.skippedDueToPressure = true;
      writeResult(result);
      return result;
    }
  } catch {
    // ignore — proceed best-effort
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const maxPhotos = opts.maxPhotos ?? 120;

  try {
    // Pull recent active-report photo URLs. We deliberately keep this read
    // narrow: only photo_url + inspection_id + updated_at; no payload data.
    let query = supabase
      .from("inspection_photos")
      .select("id, photo_url, inspection_id, updated_at")
      .is("deleted_at", null)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(maxPhotos);

    const { data, error } = await query;
    if (error) throw error;

    const rows: Array<{ photo_url?: string | null; inspection_id?: string }> =
      data || [];

    // Also fetch a small batch for the currently-open report if it falls
    // outside the 30-day window.
    if (opts.openReportId) {
      try {
        const { data: openData } = await supabase
          .from("inspection_photos")
          .select("id, photo_url")
          .eq("inspection_id", opts.openReportId)
          .is("deleted_at", null)
          .limit(40);
        if (openData) rows.push(...openData);
      } catch {
        // ignore
      }
    }

    const urls = Array.from(
      new Set(
        rows
          .map((r) => r.photo_url)
          .filter((u): u is string => typeof u === "string" && u.length > 0),
      ),
    ).slice(0, maxPhotos);

    result.attempted = urls.length;

    // Bounded concurrency (4) — let the SW cache layer pick these up.
    const queue = [...urls];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const u = queue.shift();
        if (!u) break;
        try {
          const res = await fetch(u, {
            credentials: "omit",
            cache: "force-cache",
          });
          if (res && res.ok) result.ok++;
          else result.failed++;
        } catch {
          result.failed++;
        }
      }
    });
    await Promise.all(workers);
  } catch {
    // Network or query failed — leave attempted=0, no throw.
  }

  writeResult(result);
  return result;
}
