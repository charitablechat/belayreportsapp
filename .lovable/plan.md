

# Offline Functionality Audit — Complete Findings

## Critical Gaps Found

### Gap 1: TrainingForm Save Button DISABLED When Offline
**File:** `src/pages/TrainingForm.tsx` line 1496
```
disabled={isSaving || !isOnline}
```
The "Save Progress" button is completely disabled when offline, even though the save function correctly writes to IndexedDB first and only attempts cloud sync if online. This means **users cannot manually save training reports while offline** — only auto-save (if triggered by a debounce) works.

The "Complete" button (line 1559) is also disabled offline, which is more defensible but should at least queue the completion locally.

**Fix:** Change to `disabled={isSaving}` — same as InspectionForm (line 2617) and DailyAssessmentForm (line 1557), which already work correctly offline.

### Gap 2: InspectionForm "Complete" Button DISABLED When Offline
**File:** `src/pages/InspectionForm.tsx` line 2688
```
disabled={saving || autoSaving || !isOnline}
```
Users cannot mark inspections as complete while offline. The completion should be saved locally and synced later.

**Fix:** Remove `!isOnline` from the disabled condition. The completion status change is just a field update that can be persisted locally.

### Gap 3: TrainingForm "Complete" Button DISABLED When Offline
**File:** `src/pages/TrainingForm.tsx` line 1559
```
disabled={isSaving || !isOnline}
```
Same issue as Gap 2.

**Fix:** Remove `!isOnline`.

### Gap 4: DailyAssessmentForm "Complete/Submit" Button — Already OK
Line 1620: `disabled={saving || submitting}` — no `!isOnline` check. This is correct.

### Gap 5: DOCX Import Requires Network (NewInspection)
**File:** `src/pages/NewInspection.tsx` lines 192-210
The "Import from DOCX" feature calls an edge function and requires network. This is inherently network-dependent and acceptable, but there's no offline guard — it will just fail with a network error.

**Fix:** Minor — show a toast if offline when the user tries to import, instead of letting the fetch fail silently.

## Non-Issues Confirmed
- **InspectionForm Save button**: Already works offline (`disabled={saving || autoSaving}`, no `!isOnline`)
- **DailyAssessmentForm Save button**: Already works offline (`disabled={saving || submitting}`, no `!isOnline`)
- **Photo capture (PhotoCapture.tsx & ItemPhotoUpload.tsx)**: Fully offline-capable — saves to IndexedDB + device storage immediately
- **New report creation (NewInspection, NewTraining, NewDailyAssessment)**: Already patched with `getOfflineUserId()` fallback
- **Auto-save / Emergency save**: Works offline via IndexedDB + localStorage snapshots
- **Auth**: Fully hardened with cached sessions, offline ID fallback, and token expiry bypass
- **PDF/HTML generation buttons**: Correctly disabled offline (these require edge functions)

## Summary of Changes

| File | Change | Impact |
|------|--------|--------|
| `TrainingForm.tsx` line 1496 | Remove `\|\| !isOnline` from Save button | **Critical** — enables offline manual save |
| `TrainingForm.tsx` line 1559 | Remove `!isOnline` from Complete button | Enables offline completion |
| `InspectionForm.tsx` line 2688 | Remove `\|\| !isOnline` from Complete button | Enables offline completion |
| `NewInspection.tsx` ~line 188 | Add offline guard before DOCX import fetch | Prevents confusing network error |

All other offline paths (saves, photos, creation, auth) are confirmed working across mobile, tablet, and desktop.

