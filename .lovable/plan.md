
## Fix: localStorage Backup Snapshots Always Show "Unsynced" After a Successful Online Save

### The Problem

The "Unsynced" badge in the Local Backup Snapshots panel is misleading. A report that is fully synced to the server (confirmed by the "Synced" badge on the dashboard card) still shows "Unsynced" in the Data Recovery panel.

These are two separate systems:

1. **Dashboard "Synced" badge** — reads from `synced_at` on the cloud database record. Accurate.
2. **Data Recovery "Unsynced" badge** — reads from the `synced` boolean inside the `localStorage` snapshot. Inaccurate.

**Root cause:** When a save completes and the localStorage snapshot is written (`saveReportSnapshot()`), the `synced_at` field on the local data object is still `null` at that point — the Supabase sync happens asynchronously afterward. So `!!updatedTraining.synced_at` evaluates to `false`, and the snapshot is stamped as unsynced.

The `useAutoSync` hook does call `markSnapshotSynced()` later, but only during a background sweep that runs every 30 minutes. If the user closes the app or navigates away before that sweep, the snapshot never gets corrected.

### The Fix

After a successful online save (when the Supabase upsert returns without error), explicitly call `markSnapshotSynced()` to update the localStorage snapshot's flag immediately — without waiting for the 30-minute background cycle.

This fix applies to all three report forms.

---

### Files to Change

#### `src/pages/TrainingForm.tsx`

- Import `markSnapshotSynced` from `@/lib/local-backup-ledger` (already imports `saveReportSnapshot` from the same file).
- After the successful Supabase upsert of the training (`synced_at` confirmed), call `markSnapshotSynced('training', id)`.

#### `src/pages/InspectionForm.tsx`

- Import `markSnapshotSynced` (same module already imported).
- After the final Supabase `PATCH` that sets `synced_at` on the inspection, call `markSnapshotSynced('inspection', id)`.

#### `src/pages/DailyAssessmentForm.tsx`

- Same — call `markSnapshotSynced('daily_assessment', id)` after confirmed server sync.

---

### Where Exactly to Insert the Call

Each form follows the 3-step deferred `synced_at` pattern (from architectural memory). The final step is a PATCH to set `synced_at` on the parent record. That is the correct insertion point — after this PATCH succeeds, we know the server has confirmed the sync, so we immediately mark the localStorage snapshot.

**Example (TrainingForm — conceptual):**
```
Step 1: Upsert training data (no synced_at)
Step 2: Upsert child records
Step 3: PATCH synced_at on training  ← insert markSnapshotSynced('training', id) here
```

---

### No Other Files Need Changing

- `local-backup-ledger.ts` — `markSnapshotSynced()` already exists and works correctly.
- `useAutoSync.tsx` — its 30-min sweep continues to serve as a safety net for any cases missed.
- `DataRecoveryTool.tsx` — no UI change needed; the badge renders correctly once the flag is `true`.
- No database changes. No migrations.

---

### Result

After this fix, a report that successfully syncs to the server will immediately show "Synced" in both the dashboard card AND the Data Recovery panel — eliminating the confusing discrepancy.
