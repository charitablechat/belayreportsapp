

## Fix: Dashboard Reports Not Loading After Exiting a Report

### Root Cause
The Dashboard's main data-loading `useEffect` has an empty dependency array (`[]`), meaning it only runs on the initial mount. When navigating back from a report form via `navigate(-1)`, React Router may reuse the component or the data-loading operations may clash with lingering IndexedDB connections from the form page, causing timeouts and empty results. A browser refresh works because it creates a completely fresh component lifecycle and IndexedDB connection pool.

### Solution
Add `useLocation().key` as a dependency to the Dashboard's data-loading `useEffect`. React Router assigns a unique `key` to every navigation entry, so navigating back to `/dashboard` (whether via `navigate(-1)` or `navigate('/dashboard')`) produces a new key, which re-triggers the data load.

Additionally, mark a pending dashboard refresh from the "Exit -- Nothing to Save" (discard) path in all three form pages, since currently only the "Save & Exit" path calls `markPendingDashboardRefresh()`.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Import `useLocation`, add `location.key` to the main `useEffect` dependency array |
| `src/pages/InspectionForm.tsx` | Call `markPendingDashboardRefresh()` in the `onLeave` (discard) handler |
| `src/pages/TrainingForm.tsx` | Call `markPendingDashboardRefresh()` in the `onLeave` (discard) handler |
| `src/pages/DailyAssessmentForm.tsx` | Call `markPendingDashboardRefresh()` in the `onLeave` (discard) handler |

### Technical Details

**Dashboard.tsx** (2 changes):
1. Add `useLocation` import (already using `useNavigate` from `react-router-dom`)
2. Inside the component, call `const location = useLocation();` and change the dependency array of the main `useEffect` (line 186) from `[]` to `[location.key]`

**Form Pages** (3 files, same pattern):
In the `onLeave` callback of the `SaveBeforeLeaveDialog`, add `markPendingDashboardRefresh()` before `goBack(navigate)`. This ensures the Dashboard knows to do a follow-up data reload even when the user discards changes (the report's `last_opened_at` or other metadata may have changed server-side).

