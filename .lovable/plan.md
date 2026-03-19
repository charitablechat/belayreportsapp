

## Fix: Daily Assessments Tab Not Showing Data

### Root Cause
The query on line 257 of `SuperAdminDashboard.tsx` uses an incorrect foreign key hint:
- **Used:** `profiles!daily_assessments_inspector_id_fkey`
- **Actual constraint name:** `profiles!daily_assessments_inspector_id_profiles_fkey`

This causes the PostgREST query to fail, returning no results.

### Fix

**File: `src/pages/SuperAdminDashboard.tsx`** — Line 257

Change the foreign key hint from:
```
inspector:profiles!daily_assessments_inspector_id_fkey(first_name, last_name)
```
to:
```
inspector:profiles!daily_assessments_inspector_id_profiles_fkey(first_name, last_name)
```

That's the only change needed. The rendering code (lines 1130-1171) is already correct.

