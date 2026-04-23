

## S9 + S10: Honor intentional clears + persist regression-skip counter

Two surgical fixes. S9 lets users actually empty a synced report. S10 stops the regression-skip guard from forgetting itself on reload.

---

### S9 — Disambiguate "user cleared everything" from "IDB corruption"

**Root cause.** In `atomic-sync-manager.ts` (~476–519 inspections, ~1260–1294 trainings, equivalent for assessments), if a parent record was previously synced AND the local state has zero children/summary, the guard assumes IDB corruption and *restores* the server copy into IDB, returning `{ skipped: true, reason: 'empty_local_guard' }`. There's no signal distinguishing a user who deliberately deleted every row from a stale-IDB read.

**Fix.** Add an explicit user-intent marker on the parent record, written by the form whenever the user removes the last child row in any section. The guard then becomes: "skip only if local is empty AND no clear-intent marker AND server is non-empty."

**Schema (migration).** Nullable timestamp columns — partial, no defaults, no index needed:
```sql
ALTER TABLE public.inspections       ADD COLUMN user_cleared_at timestamptz;
ALTER TABLE public.trainings         ADD COLUMN user_cleared_at timestamptz;
ALTER TABLE public.daily_assessments ADD COLUMN user_cleared_at timestamptz;
```

A timestamp (rather than boolean) lets us future-proof: the guard can compare `user_cleared_at` against `synced_at` to detect "was cleared after last sync."

**Producer changes** — wherever a delete reduces a child collection to zero, stamp the parent. Concretely:
- `src/pages/InspectionForm.tsx` — in the handlers that remove the last system / zipline / equipment / standard, and the summary-clear handler, set `user_cleared_at: new Date().toISOString()` on the parent inspection and persist via `saveInspectionOffline`.
- `src/pages/TrainingForm.tsx` — same pattern across delivery approaches / operating systems / immediate attention / verifiable items / systems-in-place / summary clears.
- `src/pages/DailyAssessmentForm.tsx` — same across the six section collections.

Centralize the stamping in a tiny helper to avoid scatter:
```ts
// src/lib/clear-intent.ts
export function markUserCleared<T extends { user_cleared_at?: string | null; updated_at?: string }>(
  parent: T,
): T {
  const now = new Date().toISOString();
  return { ...parent, user_cleared_at: now, updated_at: now };
}
```

Reset the marker on first non-empty save: when any section gains a row, the same helper sets `user_cleared_at: null`.

**Sync changes** in `atomic-sync-manager.ts`. Replace the empty-local guard at all three sites (~479, ~1263, equivalent assessments) with:
```ts
const isLocallyEmpty = localChildCount === 0;
const wasClearedByUser =
  inspection.user_cleared_at &&
  inspection.synced_at &&
  new Date(inspection.user_cleared_at) >= new Date(inspection.synced_at);

if (isLocallyEmpty && !wasClearedByUser && serverHasChildren) {
  // Existing corruption-recovery path: pull server copy into IDB, return skipped.
} else if (isLocallyEmpty && wasClearedByUser) {
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Honoring intentional user-clear for', inspection.id);
  }
  // Fall through to normal sync — child reconcile will soft-delete server children.
}
```

After a successful sync, clear `user_cleared_at` on the local record so future stale-IDB reads aren't misinterpreted as fresh user intent (the marker has done its job).

---

### S10 — Persist `regressionSkipCounter` across reloads

**Root cause.** `regressionSkipCounter` is a module-level `Map<string, number>` in `atomic-sync-manager.ts` (~71–72, consumed at ~395–425). Tab refresh, PWA wake-from-suspend, or service-worker restart wipes it, so a user whose report legitimately lost >50% of fields can ping-pong on the regression guard indefinitely if they happen to reload between cycles.

**Fix.** Promote the counter to a tiny IDB store, accessed via small async helpers. Keep the in-memory Map as a hot cache so the existing call sites can stay synchronous-feeling.

**IDB store** in `src/lib/offline-storage.ts`:
- Store name: `sync_regression_counters`
- Key: record id (string)
- Value: `{ id: string; count: number; lastIncrementAt: number }`
- Bump `DB_CONFIG.version` (currently 10 → 11) and add the store creation in the `upgrade` handler. Existing migration-safety snapshot machinery (Phase 5) covers this automatically.

**Helpers** (new file `src/lib/regression-skip-store.ts`):
```ts
export async function getRegressionSkipCount(id: string): Promise<number>;
export async function incrementRegressionSkipCount(id: string): Promise<number>;
export async function resetRegressionSkipCount(id: string): Promise<void>;
```
Each writes through to IDB *and* updates the in-memory Map.

**Wire-up** in `atomic-sync-manager.ts`:
- On module load, lazily hydrate the Map from IDB (one read at first guard hit per record id; cache miss → `getRegressionSkipCount` → fill Map).
- Replace the three Map mutation sites (increment on skip, reset on success) with calls to the new helpers. The existing synchronous reads of the Map become awaited helper calls.

**Stale-entry pruning.** Add a 30-day TTL: in `getRegressionSkipCount`, drop entries older than `lastIncrementAt + 30d` and return 0. Keeps the store from accumulating dead record ids.

---

### Files

- **New migration** — adds `user_cleared_at timestamptz` to `inspections`, `trainings`, `daily_assessments`.
- `src/lib/atomic-sync-manager.ts` — three empty-local guards updated (~479, ~1263, assessments equivalent); regression-counter Map mutations replaced with awaited helper calls (~395–425 + symmetric sites in trainings/assessments); post-sync reset of `user_cleared_at`.
- **New** `src/lib/clear-intent.ts` — `markUserCleared` helper.
- **New** `src/lib/regression-skip-store.ts` — IDB-backed counter helpers.
- `src/lib/offline-storage.ts` — bump `DB_CONFIG.version` to 11, add `sync_regression_counters` store in upgrade handler.
- `public/db-config.js` — bump `version` to 11 to keep service worker in sync.
- `src/pages/InspectionForm.tsx`, `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx` — call `markUserCleared` from final-row removal handlers; clear marker when collections regain content.

### Out of scope

- Backfilling `user_cleared_at` for legacy rows. NULL means "no signal" — guard falls back to today's behavior, which is the safe default.
- Surfacing the regression-skip counter in admin diagnostics (separate UI work).
- Replacing the field-count regression guard itself with field-merge semantics — Phase 7 territory.

### Risk

Low. S9 is additive (new column, new producer paths) — guard short-circuit only triggers when the explicit marker is set, so no behavior change for any existing record. S10 is a storage-layer move with hot-cache fallback; first read after upgrade is one extra IDB hit per record, then identical to today's behavior. IDB version bump is covered by existing Phase 5 migration safety (pre-upgrade snapshot + fingerprint validation + rollback API).

