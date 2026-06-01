# Legacy Inspection Result Wording Normalization

## Problem
Sentry surfaced (separate from ROPEWORKS-68 AbortError noise):
```
Validation failed: [{"path":"systems.0.result","message":"Invalid enum value. Expected 'pass' | 'pass w/provisions' | 'fail' | 'na', received 'pass/\nrec'"}]
```

The Zod schemas (`systemSchema`, `ziplineSchema`, `equipmentSchema`, all four `*_result` fields) enforce a strict enum of `'pass' | 'pass w/provisions' | 'fail' | 'na'`. A row reached the sync validator with the literal value `pass/\nrec` (almost certainly the historical wording "pass/rec" = "pass with recommendations", the predecessor label of "pass w/provisions", with an embedded newline from some earlier copy-paste / import path).

Until that row's `result` is normalized, **every** sync attempt for that inspection fails the same way forever. The current UI cannot fix it (the `<ResultSelect>` dropdown only emits the four canonical values, so re-opening the form will not overwrite the bad value unless the user touches that exact row).

This is purely a **legacy data compatibility** issue — no current write path produces these values. Fix is sanitization at the boundaries, not a schema or UI change.

## Goals
1. Stop the perpetual sync failure for any inspection containing a legacy / malformed result value.
2. Quietly upgrade legacy values to the closest canonical enum value at the boundary, so they pass validation and are written back to IDB + Supabase in canonical form.
3. Preserve liability semantics: never silently upgrade something destructive (e.g. `fail` → `pass`).
4. Stay cross-platform and shared-path per project rule: one shared normalizer used by every code path that reads inspection results.
5. No schema migration, no UI change, no behavioral change for already-canonical values.

## Non-goals
- No edit to the Zod enum itself. The canonical four values stay the contract.
- No edit to `<ResultSelect>` or any form UI.
- No new dropdown options. No new database columns.
- No edits to Recovery & Sync Health, training restore, photos, RLS, storage, Playwright, or the Sentry pipeline.
- No bulk server-side data fix in this slice — the in-app normalizer will heal each affected row the next time it syncs. (If, after monitoring, we still see stuck rows, we can open a separate one-off data-repair migration as a follow-up.)

## Design — shared normalizer

New module `src/lib/inspection-result-normalizer.ts`:

```ts
export const CANONICAL_RESULTS = ['pass', 'pass w/provisions', 'fail', 'na'] as const;
export type CanonicalResult = typeof CANONICAL_RESULTS[number];

/**
 * Coerce any legacy / malformed inspection result string into the
 * canonical Zod enum. Returns null for genuinely unknown values so
 * the caller can decide between "leave as-is" (sync still fails loud)
 * or "default to na" (sync succeeds, conservative). Never throws.
 *
 * Conservative mapping rules (liability-preserving):
 *   - empty / nullish / whitespace-only          → null   (unset; never invent a pass)
 *   - canonical value (case-insensitive)         → canonical
 *   - any "fail"-prefixed variant                → 'fail'
 *   - any "n/a", "na", "not applicable" variant  → 'na'
 *   - any "pass w/...", "pass with provisions",
 *     "pass/rec", "pass with recommendations",
 *     "conditional pass", etc.                   → 'pass w/provisions'
 *   - bare "pass" (no suffix, no slash, no
 *     embedded newline)                          → 'pass'
 *   - anything else                              → null
 *
 * Whitespace (including embedded \n \r \t) is collapsed before
 * matching. Slash → space. Lowercased. This is how `pass/\nrec`
 * collapses to `pass rec` → `pass w/provisions`.
 */
export function normalizeInspectionResult(raw: unknown): CanonicalResult | null;
```

Unit-tested cases (pinned in `src/lib/__tests__/inspection-result-normalizer.test.ts`):
- `'pass'`, `'PASS'`, `'Pass '` → `'pass'`
- `'pass w/provisions'`, `'Pass w/Provisions'` → `'pass w/provisions'`
- `'pass/rec'`, `'pass/\nrec'`, `'pass with recommendations'`, `'conditional pass'` → `'pass w/provisions'`
- `'fail'`, `'FAIL'`, `'failed'`, `'fail (severe)'` → `'fail'`
- `'na'`, `'n/a'`, `'N / A'`, `'not applicable'` → `'na'`
- `''`, `null`, `undefined`, `'   '`, `'something weird'` → `null`
- Liability guard: `'fail/rec'` → `'fail'` (NOT `'pass w/provisions'`); the `'fail'` prefix wins.

## Where to apply the normalizer (shared boundary, not per-platform)

The fix lives at the **persistence / sync boundary** so it heals every inspection regardless of which surface created the row (web, PWA, iPad, desktop, mobile, recovery restore, training restore that crosses into inspections, etc.).

Apply in **two** layers — both are shared modules:

1. **IDB read normalization (passive heal on next save):** in the inspection load path used by `InspectionForm.tsx` (already shared across all platforms via `getInspectionById` etc. in `src/lib/offline-storage.ts`). On load, run each `*_result` field through `normalizeInspectionResult`. If the normalized value differs from the stored value (and is non-null), mark the field as dirty so the next auto-save persists the canonical form. If normalization returns `null` for a non-empty stored value, leave it as-is so the user sees the field unset in the dropdown and can pick deliberately — never silently drop liability data.

2. **Sync push sanitization (last line of defense):** in `src/lib/atomic-sync-manager.ts` (and the parallel `public/sw-sync.js` service-worker path mirrored by `src/lib/sw-sync-validators.ts`), normalize each `*_result` field on the in-memory record copy **immediately before** Zod validation. Same shared normalizer. This guarantees that even if (1) was skipped because the inspection was never re-opened locally, the pending push gets the canonical value.

   Important: this layer must NOT mutate IDB unconditionally. It mutates the in-flight payload only. Once the upsert succeeds, the existing post-sync write-back path (which already persists `synced_at`) will also overwrite the result with the canonical value, so the next read sees the normalized form.

Other consumers of `result` (HTML report renderer, PDF generator, dashboard counts, comment-aggregation in `InspectionForm.tsx` lines 643-1086) keep their existing equality checks because once layer (1) or layer (2) runs, the stored value will be canonical. As a defensive belt-and-braces, the comment-aggregation `result === 'pass w/provisions'` comparisons can route through the normalizer too — single-line change per call site, no behavior change for canonical values.

## Telemetry (read-only, no Sentry email)

When the normalizer changes a value, emit a single `console.warn('[result-normalizer] healed:', { id, field, from, to })` line. No Sentry capture for the heal itself — by definition it is the fix, not the bug. If normalizer returns `null` for a non-empty input (genuinely unrecognized), emit a one-time per-session Sentry breadcrumb (NOT an event) with category `recoverable`, message `result-normalizer-unknown` and the offending string truncated to 32 chars, so we get aggregate visibility on any other legacy wording variants without alert noise.

## Files to add / change

- **New:** `src/lib/inspection-result-normalizer.ts` (~60 lines)
- **New:** `src/lib/__tests__/inspection-result-normalizer.test.ts` (~25 cases, including liability guard, embedded newlines, whitespace, casing, unknown → null)
- **Edit:** `src/lib/offline-storage.ts` — inspection load helper applies the normalizer to `result`, `cable_result`, `braking_result`, `ead_result` on `systems`/`ziplines`/`equipment` arrays before returning. Marks dirty when changed. (~15-line addition, no rename or restructure.)
- **Edit:** `src/lib/atomic-sync-manager.ts` — normalize result fields on the in-memory payload immediately before the existing `validateInspectionPackage` call. (~10 lines.)
- **Edit:** `public/sw-sync.js` + `src/lib/sw-sync-validators.ts` — mirror the same normalization in the service-worker sync path so background sync benefits identically. (~10 lines each; the validator test file already exists.)
- **Optional defensive:** `src/pages/InspectionForm.tsx` comment-aggregation comparisons routed through `normalizeInspectionResult` for symmetry. Skip if the load-path heal is judged sufficient — discuss in code review.

**Not touched:** `src/lib/validation-schemas.ts` (Zod enum stays), `<ResultSelect>` (already canonical), DB schema, RLS, storage, Playwright config, recovery feature, training restore, Sentry pipeline (separate slice already shipped), photo pipeline.

## Cross-platform shared-path confirmation

| User flow / platform | Shared path it goes through | Covered? |
|---|---|---|
| Web browser inspection edit + save | `getInspectionById` → IDB load heal; `atomic-sync-manager` validation heal | Yes |
| Installed PWA inspection edit + save | Same shared modules | Yes |
| iPad Safari inspection edit + save | Same shared modules | Yes |
| Background sync (service worker) | `sw-sync.js` + `sw-sync-validators.ts` heal | Yes |
| Desktop / mobile browser | Same shared modules | Yes |
| Training reports | Not affected — training schemas don't have a result enum | N/A |

No platform-specific branch. The normalizer is one pure function consumed everywhere.

## Acceptance criteria

1. A stub IDB inspection with `systems[0].result = 'pass/\nrec'` loads into the form showing `'Pass w/Provisions'` selected, auto-saves with the canonical value, and the next sync upserts cleanly with no validation error.
2. The same stub forced through `atomic-sync-manager` without re-opening the form still syncs cleanly (layer-2 heal proves itself).
3. A row with `systems[0].result = 'fail/rec'` heals to `'fail'`, not `'pass w/provisions'` — liability test.
4. A row with `systems[0].result = ''` or `null` stays empty (no invented pass).
5. A row with `systems[0].result = 'pass'` is unchanged — no dirty flag, no extra write.
6. A row with `systems[0].result = 'something weird'` does NOT heal, the inspection still fails Zod validation on push, BUT a `result-normalizer-unknown` breadcrumb is recorded so we see it in aggregate. (We want to learn about new variants, not silently swallow.)
7. All existing inspection sync tests in `src/lib/__tests__/` continue to pass unchanged.
8. New unit tests cover all mapping rules and edge cases.
9. No change to Sentry pipeline, no change to UI, no change to schema/RLS, no change to recovery / training / photos / dashboard fetches.

## Risks and mitigations

- **Risk:** mis-mapping a legacy wording to the wrong canonical value (e.g. interpreting `'rec'` as anything other than provisions). **Mitigation:** unit tests pin the mapping; ambiguous strings return `null` rather than guessing.
- **Risk:** silently overwriting an inspector's deliberate non-canonical entry. **Mitigation:** the current `<ResultSelect>` cannot produce non-canonical entries, so any non-canonical value in IDB is legacy by construction; the only way to reach IDB with a non-canonical value today is via legacy import / restore. The unknown → `null` rule + breadcrumb keeps us honest.
- **Risk:** healing a row updates `updated_at` and could collide with an in-flight Realtime edit on another device. **Mitigation:** apply the heal only when the field actually differs (already in the design), and rely on existing LWW conflict resolution (already in place) for the rare overlap.

## Follow-up (not bundled in this slice)

- After 1 week of breadcrumbs, if `result-normalizer-unknown` shows new repeating variants, extend the mapping table in a small follow-up PR.
- If breadcrumbs reveal a meaningful number of legacy rows that never re-open in the app (truly archived inspections), open a separate one-off SQL data-repair migration to normalize them server-side. Out of scope here because the in-app heal is sufficient for live use.
