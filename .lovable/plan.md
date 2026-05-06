# Why the Baylor University Outdoor card stays red

## Diagnosis (from the audit log)

Reading `audit_logs` for inspection `1f966990-…` shows the same three-step pattern repeating each time the user clicked "Complete":

```
12:15:00.114  inspections.update    status draft  → draft       (saveProgress before complete)
12:15:01.063  inspections.complete  status draft  → completed   (completeInspection write)
12:15:01.727  inspections.update    status completed → completed (deferred synced_at write)
…
12:16:44.310  inspections.update    status completed → draft    ← REVERT
12:16:44.638  inspections.update    status draft → draft         (synced_at)
```

The server is being silently reverted to `draft` ~90s after every successful completion. That is why the card on the dashboard never turns green — the dashboard reads the server, and the server keeps getting overwritten.

## Root cause

In `src/pages/InspectionForm.tsx`, `completeInspection` has two branches:

- **Offline branch (line ~2442):** calls `saveInspectionOffline(updatedInspection)` → IndexedDB now shows `status: 'completed'`. Correct.
- **Online branch (line ~2417–2436):** writes to Supabase via `supabase.from("inspections").update(...)` and updates React state with `setInspection(...)`, **but never writes the new status to IndexedDB.**

Earlier in the same flow `saveProgress()` ran `saveInspectionOffline(inspectionToSave)` with `status: 'draft'` and `dirty: true`. After completion finishes online, IDB still holds `{ status: 'draft', dirty: true }`.

`useAutoSync` later runs `syncInspectionAtomic`, which reads the inspection **from IDB** and pushes it back to Supabase as a full upsert — re-writing `status` to `'draft'` and clobbering the completion. The confetti fires (local React state did flip to completed), but the server-of-truth is reverted before the dashboard's next refetch.

A secondary bug exacerbates it: line 2426 uses a stale closure — `setInspection({ ...inspection, ...updatePayload })` — instead of a functional updater. After `await saveProgress()` runs, React state has already been advanced by `performSave`, and merging into the pre-await snapshot drops `updated_at` and any other fields that just changed. Functional `setInspection(prev => …)` is the correct pattern (and matches what `TrainingForm`/`DailyAssessmentForm` already do).

## Blast radius

- **Inspection reports**: affected — every online completion is at risk of being silently reverted by the next auto-sync cycle. Severity is highest for Admin re-edits and any user whose connection is fast enough to take the online branch.
- **Training reports** (`TrainingForm.tsx` line 1453): **not affected** — it calls `saveTrainingOffline(completedTraining)` before the Supabase write.
- **Daily assessments** (`DailyAssessmentForm.tsx` line 1273): **not affected** — it calls `saveDailyAssessmentOffline(completedAssessment)` first.

So the patch is scoped to inspections only, but I'll add a shared regression test so the two healthy forms can't regress into the same shape.

## Fix

In `src/pages/InspectionForm.tsx → completeInspection`:

1. **Mirror the offline branch in the online branch.** After the Supabase update succeeds, call `saveInspectionOffline(updatedInspection)` so IDB reflects `status: 'completed'`, the new `app_version_at_completion`, and any `attestation_*` fields. This kills the divergence that lets auto-sync overwrite the server.

2. **Use a functional state updater** for `setInspection` so the merge is applied to the latest state produced by `saveProgress()`, not the pre-await closure.

3. **Also stamp the completion's `synced_at` locally in the online branch** (the row was just confirmed written to Supabase a moment ago) so `syncInspectionAtomic` doesn't see drift and re-push.

Pseudocode for the new online branch:

```ts
if (isOnline) {
  const completionTimestamp = new Date().toISOString();
  const { error } = await supabase
    .from("inspections")
    .update(updatePayload as never)
    .eq("id", id);
  if (error) throw error;

  setInspection(prev => {
    const merged = { ...(prev ?? inspection), ...updatePayload, synced_at: completionTimestamp };
    // Persist to IDB so auto-sync doesn't revert status to 'draft'
    saveInspectionOffline(merged).catch(e =>
      console.error('[InspectionForm] Post-completion IDB save failed', e)
    );
    return merged;
  });

  if (!wasAlreadyCompleted) {
    triggerCompletionConfetti();
    triggerHaptic('success');
  }
}
```

The offline branch already does the right thing; only minor cleanup (functional updater) is needed there for consistency.

## Verification

- Manual: complete a brand-new inspection while online, wait 60–90 seconds (longer than `useAutoSync`'s active interval) without leaving the page, then refresh the dashboard. Card must show **completed** / green, not red.
- Audit-log check (re-run the same SQL on the affected row): there should be no `completed → draft` transition after the completion event.
- Existing offline-completion path still works (kept identical write order).
- Add a unit test in `src/lib/__tests__/` that simulates: offline-storage write of `{ status: 'draft', dirty: true }` → completion online path → assert IDB now reflects `status: 'completed'` and `synced_at >= updated_at` so `getUnsyncedInspections` would not pick it up.

## One-time data repair

The Baylor University Outdoor row currently shows `status: 'draft'` on the server even though the user completed it. After the fix ships, the user can simply click Complete again on that report and it will stick. No migration needed; the audit log preserves the history.

## Out of scope

- No changes to `TrainingForm`, `DailyAssessmentForm`, the dashboard's polling, or the auto-sync engine — they are healthy. The stack-overflow-style "polling on the dashboard" pattern would mask the bug, not fix it; the right fix is to stop writing the wrong value in the first place.
