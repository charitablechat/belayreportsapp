# Fix "Unknown" Inspector names in admin dashboard tables

## What's actually broken

Your screenshot is the **admin dashboard's Inspections table** (Status / Date / Created / Inspector columns), rendered by `src/pages/SuperAdminDashboard.tsx` — not the `ReportCard` grid that the previous Option B fix patched.

That table reads `(inspection as any).inspector?.first_name` directly with no fallback. When a row was last written through the local-first save path (IndexedDB), the joined `inspector` object gets stripped, so every cached row collapses to `'Unknown'` even though `inspector_id` is still on the row.

Important clarification on "creator vs editor": in this schema **`inspector_id` IS the creator** (the FK is literally named `inspections_inspector_id_profiles_fkey`). There is no separate "last editor" column being shown — the column has just lost its join. Resolving `inspector_id` correctly gives you the creator, which is what you want.

## The fix

Reuse the existing `useProfileMap` hook (already built for `ReportCard`) inside `SuperAdminDashboard`, and route every Inspector / Trainer cell through a single name-resolver helper that falls back to the map when the join is missing.

### Files to change

**1. `src/lib/report-utils.ts`** — add a small pure helper:
```ts
export function resolveProfileName(
  joined: { first_name?: string|null; last_name?: string|null } | null | undefined,
  inspectorId: string | null | undefined,
  profilesById: ReadonlyMap<string, { first_name: string|null; last_name: string|null }> | undefined,
  fallback?: string | null,
): string
```
Order: joined → profilesById.get(inspectorId) → fallback (e.g. `trainer_of_record`) → `'Unknown'`.

**2. `src/pages/SuperAdminDashboard.tsx`**
- Import `useProfileMap` and `resolveProfileName`.
- Build one combined array `[...allInspections, ...allTrainings, ...allDailyAssessments]` and feed it into `useProfileMap` once.
- Replace the four duplicated inline name expressions (inspections desktop+mobile lines 1191/1216, daily-assessments desktop+mobile lines 1325/1361, trainings desktop+mobile lines 1253/1281) with `resolveProfileName(...)` calls.
- Trainings keep `trainer_of_record` as the explicit fallback string they already use.

**3. (Optional polish) `src/components/dashboard/ReportCard.tsx` and `src/lib/report-utils.ts`** — migrate the existing `getInspectorName` / `getAssigneeName` to call the new shared `resolveProfileName` so there's one code path for every surface. No behavior change, just dedup.

### Why this is the same root cause and the same cure

`useProfileMap` already handles both halves of the problem:
1. **Online / fresh fetch path** — rows arrive with the join, the hook seeds the map synchronously, names render on first paint.
2. **Offline / cache / locally-edited path** — rows arrive without the join, the hook lazy-loads each missing `inspector_id` through `getCachedProfile` (in-memory → localStorage → DB-with-timeout → persisted last-known-good), then triggers a re-render once names land.

So the Inspector column will resolve in both scenarios, including offline where only the persisted localStorage profile cache is available.

### Out of scope

- No DB schema changes, no new query columns — `inspector_id` already encodes "creator".
- No changes to how reports are written / synced.
- No changes to the report cards (already fixed previously).

### Verification after build

- Online refresh: column shows real names immediately.
- Throttle to offline, hard reload `/dashboard`: column initially blank-or-Unknown for unknown ids, then fills in within a tick from `getCachedProfile` localStorage tier.
- Edit a report locally (which strips the join in IDB), return to admin dashboard: name still resolves via the map instead of falling back to "Unknown".
