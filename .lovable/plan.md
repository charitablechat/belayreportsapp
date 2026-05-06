## Goal

Remove the amber **"Using backup storage"** warning banner from all report forms. The hard-failure banner ("Storage unavailable") stays — that one signals a real, blocking error. The amber one is purely informational and self-healing, and you've decided it's not worth surfacing to users.

## Changes

Delete the `{usingFallbackStorage && !storageUnavailable && (...)}` JSX block in three files:

- `src/pages/InspectionForm.tsx` (around line 2863)
- `src/pages/TrainingForm.tsx` (around line 1657)
- `src/pages/DailyAssessmentForm.tsx` (around line 1692)

Also clean up the now-unused `usingFallbackStorage` from each file's destructure of `useStorageHealthCheck()` — keep `storageUnavailable` since the hard-fail banner still uses it.

## What stays the same

- `useStorageHealthCheck` hook itself — still needed for the hard-fail banner.
- Underlying circuit breaker / localStorage fallback behavior — unchanged. Data still falls back to localStorage transparently when IndexedDB struggles; users just won't see a warning about it.
- `SaveFailureBanner.tsx` — untouched.

## Risk

Low. Removing UI only; no logic changes. Users lose one signal that IDB had a hiccup, but the fallback was already self-healing and the banner had no actionable remediation.
