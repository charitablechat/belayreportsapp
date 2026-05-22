/**
 * Pure, dependency-free helper for the Training Report photo pipeline.
 *
 * Lives in its own file (no `https://esm.sh/...` imports) so vitest can
 * exercise it directly without a Deno runtime. The shared training
 * formatter re-imports this module so the edge functions and the test
 * suite stay locked to the same implementation.
 *
 * See `training-formatter.ts` for the full root-cause writeup. TL;DR:
 *
 *   - DB-level dedupe is enforced by `idx_training_photos_no_duplicates`
 *     on `(training_id, photo_url, photo_section)`.
 *   - This helper is the render-layer safety net. It collapses any
 *     residual same-`photo_url` rows (legacy data, or a future upstream
 *     regression) into a single entry so the generated Training Report
 *     never shows the same image twice.
 *   - Identity key is the storage path (`photo_url`). Filename-only
 *     dedupe is intentionally NOT used because two different uploads
 *     can legitimately share a filename.
 *   - Rows without a `photo_url` are passed through untouched so we
 *     never silently drop a genuine photo (e.g. a synthetic test row).
 *   - First-occurrence-wins under the caller's existing ordering (the
 *     edge fetch orders by `display_order`), preserving the gallery's
 *     visual order and the user-authored caption on the kept row.
 */
export function dedupeTrainingPhotos<T extends { photo_url?: string | null }>(
  photos: T[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of photos) {
    const key = p?.photo_url;
    if (!key) {
      out.push(p);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
