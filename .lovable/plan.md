## Plan — Option B: track inspection_date + 1 year, respect manual override

### Behavior
1. **Default tracking:** Whenever `inspection.inspection_date` changes (including on report-upload backfill), recompute `summary.next_inspection_date = inspection_date + 1 year`.
2. **Manual override wins:** If the user picks a date in the Summary "Next inspection date" picker, set a session ref `userTouchedNextDateRef = true`. From that point on, inspection_date changes no longer overwrite the next-date.
3. **Reset on clear:** If the user clears the next-date field, drop the flag so auto-tracking resumes.
4. **Reload safety:** On initial load, if the saved `next_inspection_date` doesn't match `inspection_date + 1y`, treat it as a prior manual override and pin the flag — so we don't clobber it.

### Files

**`src/pages/InspectionForm.tsx`** (replace lines 206-222)
- Add `userTouchedNextDateRef` and `initialNextDateCheckedRef` (session-only useRefs, not persisted).
- Add `computeNextInspectionDate(dateStr)` helper using the existing timezone-agnostic YYYY-MM-DD pattern.
- First effect: on first mount with a loaded summary, if existing `next_inspection_date` differs from computed +1y, pin `userTouchedNextDateRef = true`.
- Second effect: when `inspection.inspection_date` changes and the ref is `false`, write `next_inspection_date = inspection_date + 1y`.
- Add `handleNextDateUserEdit(cleared: boolean)` callback → sets ref to `!cleared`.
- Pass `onNextDateUserEdit={handleNextDateUserEdit}` into `<SummarySection>` at line 3261.

**`src/components/inspection/SummarySection.tsx`**
- Add optional prop `onNextDateUserEdit?: (cleared: boolean) => void`.
- In the Calendar's `onSelect`, call `onNextDateUserEdit?.(date == null)` alongside the existing `updateField("next_inspection_date", ...)`.

### Persistence note
The `userTouchedNextDate` flag is session-only — no schema changes. The reload-safety effect handles the "user reloads after manual edit" case by inferring intent from the stored value vs. the computed +1y.

### Out of scope
- The pre-existing build errors (cached-auth, atomic-sync-manager, local-backup-ledger, DataRecoveryTool, etc.) — unrelated to this task. Worth a separate sweep.

### Verdict
Approve and I'll switch to default mode and ship the two-file change.