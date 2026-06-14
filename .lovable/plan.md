## Goal

Remember the user's last-selected dashboard card layout — **List**, **Split**, or **Grid** — so it's restored next visit. One global setting across all dashboard tabs, synced across devices via the user's profile.

## Behavior

- When a user clicks a layout icon in `ViewModeToggle`, persist the choice immediately.
- On next dashboard load (any device), the saved layout is the initial view instead of the current hard-coded `'list'`.
- Optimistic: UI updates instantly; the remote write happens in the background and is best-effort (failure is silent — local cache still works).
- Offline-safe: local cache (localStorage) is always written; remote sync happens when online.

## Technical Plan

**1. Schema (one narrow migration)**
- Add nullable `dashboard_view_mode TEXT` column to `public.profiles` with CHECK constraint `IN ('list','split','grid')`. No default — null means "not set yet, use 'list'".
- Existing RLS already lets users update their own profile, so no policy changes.

**2. New hook: `src/hooks/useDashboardViewMode.tsx`**
- Reads from `localStorage['dashboard.viewMode']` synchronously for instant first paint.
- On mount, fetches `profiles.dashboard_view_mode` for the current user; if it differs from local, updates local + state (remote wins on cold start across devices).
- Exposes `{ viewMode, setViewMode }`. `setViewMode` updates state, writes `localStorage` via `safeSetItem`, and fires a debounced (~400ms) `supabase.from('profiles').update(...)` — best-effort, errors logged only.
- Validates the loaded value against the allowed set; falls back to `'list'`.

**3. Wire into `useDashboardFilters`**
- Accept an optional `initialViewMode` arg and seed `filters.viewMode` from it instead of the hard-coded `'list'`.
- When `updateFilter('viewMode', v)` is called, also call the new hook's `setViewMode(v)` so persistence happens. Cleanest: have `Dashboard.tsx` own the hook and pass a wrapped `onViewModeChange` to `ViewModeToggle` that does both.

**4. `Dashboard.tsx`**
- Call `useDashboardViewMode()` once at the top.
- Pass `viewMode` as `initialViewMode` into `useDashboardFilters`.
- Intercept the `ViewModeToggle` change handler to call both `updateFilter('viewMode', v)` and `setViewMode(v)`.

## Out of Scope

- No changes to grouping, sorting, pagination, or any other filter persistence.
- No per-tab persistence (explicitly global per user choice).
- No UI changes — same three icons.

## Files Touched

- New migration (add `profiles.dashboard_view_mode`)
- `src/hooks/useDashboardViewMode.tsx` (new)
- `src/hooks/useDashboardFilters.tsx` (accept `initialViewMode`)
- `src/pages/Dashboard.tsx` (wire hook + handler)
- `src/integrations/supabase/types.ts` regenerates automatically after migration
