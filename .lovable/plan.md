

## Fix: Stale Dashboard Data After Navigation

### Problem
When navigating away from Dashboard (e.g., to an inspection form) and returning, report counts show "0" and data doesn't load. The main `useEffect` depends on `location.key`, which may not change on back-navigation, preventing data re-fetch.

### Root Cause
The Dashboard manages all report data via manual `useState` + `useEffect` keyed on `location.key`. When React Router reuses the component or `location.key` doesn't change (back navigation), the effect doesn't re-run, leaving stale empty arrays.

### Solution
Two complementary changes in `src/pages/Dashboard.tsx`:

1. **Change useEffect dependency** from `location.key` to `location.pathname` — this ensures the effect fires whenever the user lands on the dashboard route, regardless of navigation method.

2. **Add a focused re-fetch on component mount** — a separate lightweight `useEffect` with no dependencies that always triggers data reload when Dashboard mounts (covers cases where pathname is identical but component remounted via Suspense).

3. **Add `visibilitychange` + `focus` dual listener** — the existing `visibilitychange` handler covers tab switches, but add a `window.focus` listener to catch in-app navigation returns that don't trigger visibility changes.

### Changes

**`src/pages/Dashboard.tsx`:**
- Line 367: Change `[location.key]` → `[location.pathname]`
- Add a new `useEffect` that calls `loadAllData` on mount with a short debounce to avoid double-fetching when `location.pathname` effect also fires
- Wrap `loadInspections`, `loadTrainingReports`, `loadDailyAssessments` in `useCallback` so they're stable references (needed for the new effect)

### Why not React Query for reports?
The Dashboard uses a complex merge strategy (offline IndexedDB + Supabase + orphan cleanup). Migrating to React Query would be a large refactor. The targeted fix above solves the stale data issue without restructuring the data pipeline.

