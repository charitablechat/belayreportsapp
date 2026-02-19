

# Data Integrity Audit: Findings and Remediation Plan

## Audit Summary

After a comprehensive review of the offline storage layer, data recovery tool, metric calculations, and form persistence logic, I identified **5 actionable findings** across 4 files. The system is already very well-hardened, but these gaps could cause hangs, silent data loss, or incorrect admin metrics under specific conditions.

---

## Finding 1: Unprotected IndexedDB Operations in `offline-storage.ts`

**Risk: MEDIUM** -- Six functions directly call `getDB()` and perform IndexedDB operations without the `withIndexedDBErrorBoundary` wrapper. If IndexedDB hangs (common on mobile Safari), these calls will never resolve, causing the UI to freeze indefinitely.

**Affected functions (lines 769-799):**
- `removeQueuedOperation(id)` -- line 769
- `clearAllQueuedOperations()` -- line 778
- `clearAllQueuedAssessmentOperations()` -- line 786
- `clearAllQueuedTrainingOperations()` -- line 794

**Fix:** Wrap each function body in `withIndexedDBErrorBoundary(...)` with `undefined` as the fallback value, matching the pattern used everywhere else in the file.

---

## Finding 2: Data Recovery Tool Sync Functions Set `synced_at` Prematurely

**Risk: MEDIUM** -- The manual sync functions in `DataRecoveryTool.tsx` (`syncTrainingToDatabase`, `syncDailyAssessmentToDatabase`, `syncInspectionToDatabase`) set `synced_at` in the same upsert as the parent data. This violates the deferred `synced_at` pattern used by `atomic-sync-manager.ts` and `sw-sync.js`. If child data (delivery approaches, equipment, etc.) fails to sync afterward, the parent will be marked as synced but incomplete.

**Affected lines:** ~425-523 in DataRecoveryTool.tsx

**Fix:** Split each sync function into the 3-step deferred pattern:
1. Upsert parent data WITHOUT `synced_at`
2. Upsert all child data
3. Final PATCH to set `synced_at` and `updated_at`

---

## Finding 3: Completion Time Metric Can Produce NaN/Infinity

**Risk: LOW** -- In `SuperAdminDashboard.tsx` (line 297-303), the avg completion time calculation uses `created_at!` with a non-null assertion. If `created_at` is somehow null (edge case with old records), `new Date(null!).getTime()` returns `0` (epoch), producing an artificially large duration. The `.filter(h => h > 0)` guard catches negative values but not absurdly large ones (e.g., 480,000+ hours for a record from epoch).

**Fix:** Add an upper-bound filter to exclude durations over a reasonable maximum (e.g., 8760 hours = 1 year), and add a null guard on `created_at`:

```typescript
const durations = data
  .filter(i => i.created_at) // guard against null created_at
  .map((inspection) => {
    const startTime = inspection.started_at
      ? new Date(inspection.started_at).getTime()
      : new Date(inspection.created_at!).getTime();
    const endTime = new Date(inspection.updated_at!).getTime();
    return (endTime - startTime) / (1000 * 60 * 60);
  })
  .filter(h => h > 0 && h < 8760); // exclude negatives AND impossibly long durations
```

---

## Finding 4: Recovery Tool `handleBatchDelete` Has No Timeout

**Risk: LOW** -- The `handleBatchDelete` function (line 367-387) calls `Promise.all(promises)` on an unbounded array of `removeQueuedOperation` calls. Since `removeQueuedOperation` itself lacks the error boundary (Finding 1), a single hung operation will block the entire batch indefinitely.

**Fix:** This is resolved transitively by Finding 1 (wrapping the remove functions). Additionally, add a 10-second `Promise.race` timeout around the batch `Promise.all` as a safety net:

```typescript
await Promise.race([
  Promise.all(promises),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Batch delete timeout')), 10000)
  ),
]);
```

---

## Finding 5: Hardcoded Anon Key in `sw-sync.js` (Informational)

**Risk: INFORMATIONAL** -- The Supabase anon key is hardcoded in `public/sw-sync.js` (lines 126, 269, 351, 454). This is the **publishable** anon key (not a secret), and Service Workers cannot access `import.meta.env` or `.env` files, so hardcoding is the only option. RLS policies protect the data. **No action needed** -- documented for awareness.

---

## Implementation Plan

### File 1: `src/lib/offline-storage.ts`

Wrap 4 functions with `withIndexedDBErrorBoundary`:
- `removeQueuedOperation` (line 769)
- `clearAllQueuedOperations` (line 778)
- `clearAllQueuedAssessmentOperations` (line 786)
- `clearAllQueuedTrainingOperations` (line 794)

### File 2: `src/components/admin/DataRecoveryTool.tsx`

Refactor 3 sync functions to use deferred `synced_at` pattern:
- `syncTrainingToDatabase` (~line 425)
- `syncDailyAssessmentToDatabase` (~line 458)
- `syncInspectionToDatabase` (~line 490)

Each becomes a 3-step process: upsert parent (no synced_at) -> upsert children -> final PATCH with synced_at + updated_at.

### File 3: `src/pages/SuperAdminDashboard.tsx`

Update the avg completion time calculation (line 297-303):
- Add null guard on `created_at`
- Add upper-bound filter (`h < 8760`) to exclude impossible durations

### File 4: `src/components/admin/DataRecoveryTool.tsx`

Add 10-second timeout to `handleBatchDelete` `Promise.all` (line 377-379).

---

## What Was NOT Found (Already Protected)

- **getQueued*Operations**: Already wrapped in `withIndexedDBErrorBoundary` -- confirmed safe
- **loadLocalData timeout**: Already has a 10-second `Promise.race` timeout (line 264-276) -- confirmed safe
- **InspectionForm loadInspection**: Already has 15-second safety timeout + per-query 8-second timeouts -- confirmed safe
- **localStorage snapshot restore**: Uses synchronous `getReportSnapshot` -- cannot hang
- **Empty array overwrites**: Blocked by `data.length === 0 && !options?.allowEmpty` guards in all save functions
- **Sensitive secrets in frontend**: Only the publishable anon key exists (required for client-side SDK); no service role keys or other secrets found

