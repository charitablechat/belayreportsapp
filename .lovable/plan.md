

## S30 — Eliminate redundant child-count-hint scans on every save

### Problem

`saveInspectionOffline`, `saveDailyAssessmentOffline`, and `saveTrainingOffline` each run **5–6 parallel `getAllFromIndex` reads on every call** to compute `child_count_hint`. During typing-driven auto-save (every 1.5 s), this is 5–6 extra IDB reads per burst per report — purely diagnostic data consumed only by the service-worker sync regression guard. On iOS this measurably worsens the IDB contention that S2/S11 were built to mitigate.

### Design

**Move hint computation off the parent-save hot path** by giving it three cheaper sources of truth, in priority order:

1. **Caller-provided hint (preferred).** Add an optional second argument `opts?: { childCountHint?: number }`. The form components that mutate children (InspectionForm, TrainingForm, DailyAssessmentForm) already hold the in-memory arrays they just modified, so they can pass `{ childCountHint: systems.length + ziplines.length + … }` for free. No IDB reads.

2. **Stamp on child writes, not parent writes.** The functions that actually mutate children — `saveRelatedDataOffline`, `saveTrainingDataOffline`, `saveAssessmentDataOffline` — already touch the relevant child store. After their write, do one cheap `count()` per affected store (or use the array length they were just passed) and patch `child_count_hint` onto the parent row inline. This way the hint is recomputed only when children actually change, not on every keystroke that updates parent fields.

3. **Preserve existing value when neither is available.** If the caller doesn't pass a hint and the save is a parent-only save (no child mutation), keep the existing `inspection.child_count_hint` value already on the row — do NOT scan. A stale hint is fine for the SW guard (the guard is "is current count drastically below the last known total?"; a slightly old hint just means the guard is slightly more permissive on the next sync, which is the safe direction).

### Files

- **`src/lib/offline-storage.ts`**
  - `saveInspectionOffline(inspection, opts?)` — replace the 5-read scan (L1149–1163) with: `if (opts?.childCountHint != null) inspection.child_count_hint = opts.childCountHint;` else preserve existing value. Same shape change for `saveDailyAssessmentOffline` (L2218–2236) and `saveTrainingOffline` (L2566–2585).
  - `saveRelatedDataOffline` / `saveTrainingDataOffline` / `saveAssessmentDataOffline` — after the child write, fetch the parent row, compute the new total from `data.length` plus `count()` on the *other* relevant stores via a single shared transaction (one read per other store, but only on actual child mutation, not every parent save). Patch `child_count_hint` on the parent and `put` it back. Keep this fire-and-forget so it never blocks the child save.

- **`src/pages/InspectionForm.tsx`, `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx`** — at each `saveInspectionOffline`/`saveTrainingOffline`/`saveDailyAssessmentOffline` call site that already knows the in-memory child arrays, pass `{ childCountHint: <sum> }` so the parent save path requires zero extra reads.

- **No changes** to `public/sw-sync.js` — the guard contract (compare live count to `child_count_hint`) is unchanged.

### Out of scope

- Redesigning the SW regression guard itself (separate concern, S6/S11 territory).
- Removing the field entirely — it's still a valuable safety net for partial-read SW scenarios.

### Risk

Low. Worst case: if a caller forgets to pass the hint *and* mutates children via a path that doesn't go through the child-save helpers, the hint goes stale. The SW guard then becomes more lenient (lets the sync proceed even when live count is below an older hint), which is the safer direction — the dangerous direction (false-positive regression block) is unaffected.

### Verification

- `npx tsc --noEmit`.
- Manual: type rapidly in an inspection form for 10 s, confirm Performance tab shows ~0 extra `getAllFromIndex` calls per parent save (vs. 5 before).
- Manual: add/remove a system row, sync, confirm `child_count_hint` on the parent matches the new total in the IDB inspector.
- Manual: trigger the SW regression guard by manually clearing one child store before sync; confirm SW still defers the cycle (guard still works).

