import { useEffect, useMemo, useRef, useState } from "react";
import { getCachedProfile, type ProfileData } from "@/lib/profile-cache";

/**
 * Builds a `Map<inspector_id, ProfileData>` for all reports the dashboard
 * is currently rendering, so cards/sorts/groups can resolve a display
 * name even when the row in IndexedDB was written without the joined
 * `inspector` / `trainer` profile blob.
 *
 * Strategy:
 *   1. Synchronous seed from any row that already carries the join
 *      (`row.inspector` for inspections/daily, `row.trainer` for trainings).
 *      Fresh server fetches always hit this path.
 *   2. For ids still missing after seeding, lazily call `getCachedProfile`
 *      (in-memory → localStorage → DB with timeout). Covers offline /
 *      first-paint-from-IDB / locally-edited drafts where the join was
 *      stripped on save.
 */
export function useProfileMap(reports: ReadonlyArray<Record<string, any>>): Map<string, ProfileData> {
  const [, forceTick] = useState(0);
  const mapRef = useRef<Map<string, ProfileData>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());

  // 1. Synchronous seed — runs whenever the rendered reports change.
  const seeded = useMemo(() => {
    const map = mapRef.current;
    let mutated = false;
    for (const r of reports) {
      const id = r?.inspector_id;
      if (typeof id !== "string" || !id) continue;
      const join = r.trainer || r.inspector;
      if (!join) continue;
      const first = (join.first_name ?? null) as string | null;
      const last = (join.last_name ?? null) as string | null;
      const avatar = (join.avatar_url ?? null) as string | null;
      if (!first && !last && !avatar) continue;
      const existing = map.get(id);
      if (
        existing &&
        existing.first_name === first &&
        existing.last_name === last &&
        existing.avatar_url === avatar
      ) {
        continue;
      }
      map.set(id, {
        first_name: first,
        last_name: last,
        avatar_url: avatar,
        acct_number: existing?.acct_number ?? null,
      });
      mutated = true;
    }
    // Always return the same ref so consumers can rely on identity for memo
    // keys; React tree re-renders are driven by `reports` prop changes and
    // `forceTick` from the async fill below.
    return mutated ? new Map(map) : map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports]);

  // 2. Lazy fetch for any ids still missing.
  useEffect(() => {
    let cancelled = false;
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const r of reports) {
      const id = r?.inspector_id;
      if (typeof id !== "string" || !id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      if (mapRef.current.has(id)) continue;
      if (inFlightRef.current.has(id)) continue;
      missing.push(id);
    }
    if (missing.length === 0) return;
    for (const id of missing) inFlightRef.current.add(id);

    (async () => {
      let added = false;
      for (const id of missing) {
        try {
          const profile = await getCachedProfile(id);
          if (cancelled) return;
          if (profile) {
            mapRef.current.set(id, profile);
            added = true;
          }
        } catch {
          // Ignore — name will keep showing 'Unknown' rather than crash a card.
        } finally {
          inFlightRef.current.delete(id);
        }
      }
      if (added && !cancelled) forceTick(n => n + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [reports]);

  return seeded;
}
