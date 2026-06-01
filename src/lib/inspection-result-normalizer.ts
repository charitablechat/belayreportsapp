/**
 * Shared, cross-platform normalizer for inspection result enum values.
 *
 * The canonical Zod enum is `'pass' | 'pass w/provisions' | 'fail' | 'na'`
 * (see `src/lib/validation-schemas.ts`). Historical / imported rows may
 * still contain legacy wording such as `pass/rec`, `pass/\nrec`,
 * `pass with recommendations`, `conditional pass`, `n/a`, `failed`, etc.
 * The current `<ResultSelect>` UI cannot emit those, so they only reach
 * IndexedDB via legacy imports or older app versions — but once present
 * they block every future sync of that inspection.
 *
 * This module is the single source of truth for translating any raw
 * result string into the canonical enum. It is consumed by:
 *   - the IDB load path (`getRelatedDataOffline` in `offline-storage.ts`)
 *   - the sync push pipeline (`atomic-sync-manager.ts`) just before Zod
 *   - the service-worker sync path (`public/sw-sync.js`)
 *
 * Rules are liability-preserving: ambiguous strings return `null` rather
 * than guessing, and any `fail`-prefixed variant always heals to `'fail'`
 * (never to `'pass w/provisions'`).
 */

export const CANONICAL_RESULTS = [
  'pass',
  'pass w/provisions',
  'fail',
  'na',
] as const;

export type CanonicalResult = (typeof CANONICAL_RESULTS)[number];

/** Field names on systems / ziplines / equipment that hold a result enum. */
export const RESULT_FIELDS = [
  'result',
  'cable_result',
  'braking_result',
  'ead_result',
] as const;

export type ResultFieldName = (typeof RESULT_FIELDS)[number];

/**
 * Coerce any legacy / malformed inspection result string into the
 * canonical Zod enum, or `null` if it is empty or genuinely unknown.
 *
 * Never throws.
 */
export function normalizeInspectionResult(raw: unknown): CanonicalResult | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;

  // Collapse whitespace (incl. embedded \n \r \t), normalise slashes, lowercase.
  const collapsed = raw
    .replace(/[\s/]+/g, ' ')
    .trim()
    .toLowerCase();
  if (collapsed === '') return null;

  // Liability guard: any "fail"-prefixed variant always heals to 'fail',
  // never to 'pass w/provisions', even if it also contains "rec" etc.
  if (collapsed === 'fail' || collapsed.startsWith('fail ') || collapsed.startsWith('failed')) {
    return 'fail';
  }

  // N/A family.
  if (
    collapsed === 'na' ||
    collapsed === 'n a' ||
    collapsed === 'not applicable' ||
    collapsed === 'n/a'.replace(/[\s/]+/g, ' ').trim()
  ) {
    return 'na';
  }

  // Pass-with-provisions family (legacy "pass/rec", "pass with recommendations",
  // "conditional pass", "pass w provisions", etc.).
  if (collapsed === 'pass w provisions' || collapsed === 'pass with provisions') {
    return 'pass w/provisions';
  }
  if (collapsed.startsWith('pass w ') || collapsed.startsWith('pass with ')) {
    return 'pass w/provisions';
  }
  if (collapsed === 'pass rec' || collapsed === 'pass recs' || collapsed === 'pass recommendation' || collapsed === 'pass recommendations') {
    return 'pass w/provisions';
  }
  if (collapsed === 'conditional pass' || collapsed === 'pass conditional') {
    return 'pass w/provisions';
  }

  // Bare pass.
  if (collapsed === 'pass' || collapsed === 'passed') {
    return 'pass';
  }

  return null;
}

/**
 * Normalize all result fields on a single row in-place-safe (returns a
 * shallow-cloned row only if any field changed). Returns `{ row, changed }`.
 *
 * - If the stored value is canonical, no change.
 * - If the normalizer returns a different canonical value, the row is
 *   updated and `changed = true`.
 * - If the normalizer returns `null` for a non-empty value (genuinely
 *   unknown), the row is left untouched so the caller can surface it
 *   loudly — we never silently drop liability data.
 */
export function normalizeResultFieldsOnRow<T extends Record<string, unknown>>(
  row: T,
): { row: T; changed: boolean; unknowns: Array<{ field: ResultFieldName; raw: string }> } {
  let changed = false;
  let next: T = row;
  const unknowns: Array<{ field: ResultFieldName; raw: string }> = [];

  for (const field of RESULT_FIELDS) {
    if (!(field in row)) continue;
    const raw = row[field];
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw !== 'string') continue;

    const normalized = normalizeInspectionResult(raw);
    if (normalized === null) {
      // Genuinely unknown — leave as-is so Zod still complains loudly.
      unknowns.push({ field, raw: raw.slice(0, 32) });
      continue;
    }
    if (normalized !== raw) {
      if (next === row) next = { ...row };
      (next as Record<string, unknown>)[field] = normalized;
      changed = true;
    }
  }

  return { row: next, changed, unknowns };
}

/**
 * Normalize an array of rows. Returns a new array only if anything
 * changed; otherwise the original array reference is returned so
 * callers can cheaply detect no-op.
 */
export function normalizeResultFieldsOnRows<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
): { rows: T[]; changed: boolean; unknowns: Array<{ index: number; field: ResultFieldName; raw: string }> } {
  let anyChanged = false;
  const out: T[] = new Array(rows.length);
  const unknowns: Array<{ index: number; field: ResultFieldName; raw: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const { row, changed, unknowns: rowUnknowns } = normalizeResultFieldsOnRow(r);
    out[i] = row;
    if (changed) anyChanged = true;
    for (const u of rowUnknowns) unknowns.push({ index: i, ...u });
  }

  return { rows: anyChanged ? out : (rows as T[]), changed: anyChanged, unknowns };
}
