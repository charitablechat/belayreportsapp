

## Remaining Gaps in Save/Toast Pipeline

Five additional issues found beyond the previous fixes:

### Gap 1: Fire-and-Forget Local Save (Training & DailyAssessment) — DATA RACE

**Both forms do NOT `await` the local IndexedDB save.** `Promise.all(childOps)` is called without `await` (lines 710 and 732 respectively). The function immediately proceeds to server sync. This means:

- Server sync can complete and set `synced_at` **before** local IndexedDB write finishes
- If IndexedDB is slow/fails, the server has data the local store doesn't — breaking offline-first guarantees
- If the user goes offline after sync but before IndexedDB completes, the local store has stale data

**InspectionForm does this correctly** — it `await`s `Promise.all(childSaveOps)` at line 1439.

**Fix:** Change `Promise.all(childOps).then(...)` to `await Promise.all(childOps)` in both TrainingForm and DailyAssessmentForm, and move the toast/appendVersion calls inline after the await (matching InspectionForm's pattern).

---

### Gap 2: Server Sync Proceeds Even When Local Save Fails (Training & DailyAssessment)

Because the local save is fire-and-forget, its `.catch()` shows an error toast but **does not prevent** the online sync section from executing. The server gets data that was never persisted locally. If the app crashes or goes offline, the local store is stale.

**Fix:** After making the local save `await`ed (Gap 1), wrap the server sync in a guard: only proceed if local save succeeded.

---

### Gap 3: Double Toast on DailyAssessment Manual Save

When a user manually saves a DailyAssessment while online:
1. `showHardSavedToast(...)` fires at line 736 (after local save)
2. `toast.success("Progress saved")` fires at line 920 (after server sync)

Two competing toasts. The second may overwrite the first (sonner's `TOAST_LIMIT = 1` in use-toast, and sonner itself has similar behavior).

**Fix:** Remove `toast.success("Progress saved")` at line 920 — the hard-saved toast already confirms persistence.

---

### Gap 4: `showHardSavedToast` Bypasses Mobile Toast Filter

`src/lib/toast-helpers.ts` imports `toast` directly from `"sonner"` (line 1), NOT from the mobile-aware wrapper at `@/components/ui/sonner.tsx`. This means `showHardSavedToast` bypasses the criticality classification system and always renders a raw sonner toast, even on mobile where standard toasts are routed to the notification center.

On mobile, this toast may render inconsistently depending on sonner's internal queue state — sometimes appearing, sometimes not.

**Fix:** Change `import { toast } from "sonner"` to `import { toast } from "@/components/ui/sonner"` in `toast-helpers.ts`. Then ensure `showHardSavedToast` messages are classified as `'critical'` in the notification config so they always show.

---

### Gap 5: `appendVersion` Hardcoded to `'auto_save'` (Training & DailyAssessment)

Both forms pass `'auto_save'` as the save type to `appendVersion` regardless of whether the save was manual or automatic:
- TrainingForm line 724: `'auto_save'`
- DailyAssessmentForm line 746: `'auto_save'`

This means version history cannot distinguish manual saves from auto-saves, making audit/recovery harder.

**Fix:** Change to `silent ? 'auto_save' : 'manual_save'` (matching InspectionForm's pattern).

---

### Files to Edit

| File | Gaps |
|------|------|
| `src/pages/TrainingForm.tsx` | 1, 2, 5 |
| `src/pages/DailyAssessmentForm.tsx` | 1, 2, 3, 5 |
| `src/lib/toast-helpers.ts` | 4 |

### Priority

**Gap 1 + 2** are the most critical — they can cause data loss (server has data local store doesn't). Gap 3 is UX noise. Gap 4 is inconsistent mobile behavior. Gap 5 is metadata quality.

