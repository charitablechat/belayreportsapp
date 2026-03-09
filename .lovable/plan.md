

# Investigation: Operating Systems Order Jumbled on Refresh

## Root Cause

The `display_order` column exists and the InspectionForm correctly **saves** it (line 1475: `systems.map((s, i) => ({ ...s, display_order: i }))`), and **loads** with `.order("display_order")` from the database. However, **multiple other code paths ignore `display_order`**, causing the order to break.

### Gap 1: IndexedDB reads return unsorted data
`getRelatedDataOffline()` uses `index.getAll(inspectionId)` which returns items in IndexedDB insertion order — **not** by `display_order`. When the form loads from IndexedDB (offline-first path), or when the sync manager reads data to push to the server, the array order is arbitrary.

### Gap 2: Sync manager doesn't sort before upserting
`atomic-sync-manager.ts` line 484-489 pushes `systems` directly to the upsert steps without sorting by `display_order`. If IndexedDB returned them jumbled, the `display_order` values in each object are correct, so this path is actually OK — the values are persisted. But the **recovery path** (line 418+) that pulls server data back into IndexedDB doesn't sort either, and any code that reads from IndexedDB and renders directly will show wrong order.

### Gap 3: HTML report generator has no ordering
`generate-inspection-html/index.ts` line 285 fetches `inspection_systems` without `.order("display_order")` — systems appear in arbitrary database order in generated reports.

### Gap 4: PDF generator has no ordering  
`generate-inspection-pdf/index.ts` line 65 — same problem, no `.order("display_order")`.

### Gap 5: Service Worker sync reads from IndexedDB unsorted
`sw-sync.js` line 310 reads via `getAllRelatedData` which has no sort — if it upserts these items and they had stale/missing `display_order` values, the database state could be corrupted.

## Plan

### 1. Sort IndexedDB reads by `display_order` (`src/lib/offline-storage.ts`)
In `getRelatedDataOffline()`, after fetching from IndexedDB, sort the result array by `display_order` before returning. This fixes all consumers (form load, sync manager reads, version snapshots).

### 2. Add `.order("display_order")` to HTML generator (`supabase/functions/generate-inspection-html/index.ts`)
Add `.order("display_order")` to the `inspection_systems`, `inspection_ziplines`, and `inspection_equipment` queries.

### 3. Add `.order("display_order")` to PDF generator (`supabase/functions/generate-inspection-pdf/index.ts`)
Same fix for all three child table queries.

### 4. Sort in Service Worker after IndexedDB read (`public/sw-sync.js`)
After `getAllRelatedData`, sort systems/ziplines/equipment by `display_order` to ensure consistent upsert ordering.

## Files Changed

- `src/lib/offline-storage.ts` — sort `getRelatedDataOffline` results by `display_order`
- `supabase/functions/generate-inspection-html/index.ts` — add `.order("display_order")` to systems, ziplines, equipment queries
- `supabase/functions/generate-inspection-pdf/index.ts` — add `.order("display_order")` to systems, ziplines, equipment queries
- `public/sw-sync.js` — sort child data by `display_order` after IndexedDB read

