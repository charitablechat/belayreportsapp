
## Fix Plan: Reliable Auto-Refresh for Reports (Desktop, Mobile, iPad)

### What I found
- The dashboard reports are loaded by `src/pages/Dashboard.tsx` via `loadInspections`, `loadTrainingReports`, and `loadDailyAssessments`.
- Console logs from your failing session show all three network fetches timing out at 15s.
- Current logic only shows offline IndexedDB data when `navigator.onLine === false`, so in “online but slow/stalled” cases the UI can stay empty and show `0`.
- There is retry logic, but `dataLoadedRef` is never updated, so success/failure tracking is effectively broken.
- iPad/Safari restore flows are not fully covered (focus/visibility alone can miss bfcache restore cases).

### Implementation scope
- Apply to **all report categories** in dashboard reports: Inspections, Training, Daily.
- Ensure both **Recent Reports** and **All Reports** get fresh data from the same refreshed source arrays.

### Changes to implement

1. **Harden loader behavior for each report type (`Dashboard.tsx`)**
   - Update all 3 loaders to return a structured result (e.g. `source: "network" | "offline" | "empty" | "timeout" | "error"` and count).
   - Use offline data as immediate fallback even when online (stale-while-revalidate behavior), instead of requiring offline mode.
   - Only set array to `[]` when server explicitly returns confirmed empty data.
   - On timeout/error, do not wipe existing in-memory data.

2. **Centralize refresh into one guarded function**
   - Create a single `refreshReports` callback that:
     - validates session first,
     - runs the 3 loaders in parallel,
     - records per-category outcomes,
     - deduplicates concurrent refreshes (in-flight guard),
     - throttles rapid re-triggers to avoid request storms.
   - Replace scattered repeated `Promise.all([...loadX])` blocks with this one function.

3. **Fix refresh triggers for navigation/resume scenarios**
   - Trigger `refreshReports` on:
     - dashboard mount / route re-entry,
     - window focus,
     - document visible,
     - network reconnect,
     - sync-complete event,
     - pending dashboard refresh flag.
   - Add `pageshow` handling for iPad/Safari bfcache restores.

4. **Fix loading/placeholder behavior to prevent false “0”**
   - Keep report tab counters in validating state (`…`) until first meaningful resolution (network success, confirmed empty, or offline fallback).
   - Do not flip to a hard `0` while all loaders are unresolved/timeing out.
   - Replace current `dataLoadedRef` pattern with real loader-result state.

5. **Preserve performance and stability**
   - Keep existing 15s timeout, but add bounded retry/backoff only when all categories timeout/error.
   - Ensure event listeners are cleaned up correctly on unmount.
   - Avoid adding extra polling loops.

### Files to update
- `src/pages/Dashboard.tsx` (primary and likely only required file)

### Validation checklist
1. Desktop: open dashboard → navigate to a report → return to dashboard; counts and cards rehydrate automatically (no manual refresh).
2. Mobile/iPad: background app/tab and return; verify refresh triggers and no persistent `0`.
3. Slow network simulation: confirm offline/cache fallback appears, then live network data replaces it.
4. Confirm all three categories refresh consistently (Inspections, Training, Daily) in both Recent and All tabs.
5. Confirm no excessive repeated requests after focus/visibility churn.
