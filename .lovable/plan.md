

## Fix Background Sync False-Success Bug

### Problem
The `executeTransaction()` function and `align_synced_at` error handling in the atomic sync manager allow reports to be marked as "synced" locally even when 0 rows were written to the server. This is the root cause of the Marine Military Academy report (and potentially others) appearing synced on the mobile laptop but missing from the central database.

### Safety Confirmation
These changes are strictly additive and defensive. No existing data loss protections are modified or removed:
- No DELETE calls introduced
- No destructive operations added
- Triple-Copy Backup, Emergency Save, Write-Ahead Log, regression guards all untouched
- The only behavioral change: records that previously got falsely marked "synced" will now correctly stay "unsynced" and keep retrying

---

### Change 1: Row-Count Verification in `transaction-manager.ts`

**File:** `src/lib/transaction-manager.ts`

Add `.select('id')` to `upsert` and `update` operations, then verify that at least 1 row was returned. For batch operations (arrays), verify the returned count matches the input count.

```text
Current (broken):
  case 'upsert':
    result = await supabase.from(table).upsert(data);  // no verification
    break;

Fixed:
  case 'upsert':
    result = await supabase.from(table).upsert(data).select('id');
    // After the switch: verify result.data has rows
    break;
```

After the switch statement, add a row-count check:
- For single-item operations: throw if `result.data` is null or empty
- For batch operations (Array.isArray(step.data)): throw if returned count < input count
- Skip verification for `delete` operations (already protected by REPORT_TABLE_BLOCKLIST)

### Change 2: Strict `align_synced_at` Handling in `atomic-sync-manager.ts`

**File:** `src/lib/atomic-sync-manager.ts`

In all three sync functions (inspections, trainings, daily assessments), change the `align_synced_at` RPC error handling:

**Current (broken):**
- If RPC returns null -> falls back to `new Date().toISOString()` -> marks record as synced
- If RPC throws -> catches error, uses fake timestamp -> marks record as synced

**Fixed:**
- If RPC returns null or error response -> throw an error with message "Sync verification failed: server record not found"
- If RPC throws -> re-throw the error (don't swallow it)
- This causes the sync attempt to fail, leaving the local record as "unsynced" so it retries on the next cycle

### Change 3: Post-Transaction Server Verification in `atomic-sync-manager.ts`

**File:** `src/lib/atomic-sync-manager.ts`

After `executeTransaction` reports success in each sync function, add a lightweight read-back:

```typescript
const { data: verify } = await supabase
  .from('inspections')  // or 'trainings' / 'daily_assessments'
  .select('id, synced_at')
  .eq('id', recordId)
  .maybeSingle();

if (!verify) {
  throw new Error('Post-sync verification failed: record not found on server');
}
```

This catches the edge case where the transaction "succeeded" but RLS silently blocked all writes. If verification fails, the record stays unsynced and retries.

---

### Files Modified

| File | Type of Change |
|------|---------------|
| `src/lib/transaction-manager.ts` | Add `.select('id')` + row-count verification to upsert/update cases |
| `src/lib/atomic-sync-manager.ts` | Fix align_synced_at null handling; add post-transaction verification read |

### What Stays Unchanged
- All three report form files (InspectionForm, TrainingForm, DailyAssessmentForm) - already fixed in prior commit
- IndexedDB circuit breaker, timeout logic, error boundaries
- Triple-Copy Backup, Emergency Save, Write-Ahead Log
- Empty-array and field-count regression guards
- REPORT_TABLE_BLOCKLIST preventing DELETEs
- All RLS policies and database triggers/functions

