

# Fix: Avg Completion Time Card Showing "0h"

## Root Cause

The query on line 291 of `SuperAdminDashboard.tsx` filters with `.not("started_at", "is", null)`, requiring `started_at` to be non-null. However, **zero completed inspections** in the database have a `started_at` value populated. The column exists but is never written to during normal usage. This causes the query to return an empty dataset, resulting in `0`.

## Solution

### 1. Fix the query to use available data (immediate)

**File: `src/pages/SuperAdminDashboard.tsx` (lines 280-310)**

Remove the `.not("started_at", "is", null)` filter and fall back to `created_at` when `started_at` is null (which is always, currently). The calculation becomes: `updated_at - created_at` for completed inspections, measuring wall-clock time from creation to completion.

```
// Before (broken):
.not("started_at", "is", null)

// After (works with existing data):
// Remove that filter entirely. The reduce already handles the fallback.
```

Also include trainings and daily assessments in the metric for a more holistic view, or at minimum note that it only covers inspections.

### 2. Populate `started_at` going forward (recommended)

**File: `src/pages/InspectionForm.tsx`**

When the inspection form is first opened/loaded, set `started_at = NOW()` if it is currently null. This creates a meaningful "active start" timestamp for future inspections, enabling more accurate duration tracking later.

### 3. Improve the hover content to show detail breakdown

Update the StatCard's `hoverContent.details` to show:
- Number of completed inspections used in the calculation
- Time window (last 30 days)
- Shortest and longest completion times

### 4. Active usage time (future consideration)

True "active usage time" (excluding idle/closed periods) would require session heartbeat tracking -- writing a `last_active_at` timestamp periodically while the form is open, and accumulating active session durations. This is a significant feature addition and is **not part of this fix**. The plan focuses on making the existing metric work correctly with available data.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/SuperAdminDashboard.tsx` | Remove `.not("started_at", "is", null)` filter; enhance hover details with count and range |
| `src/pages/InspectionForm.tsx` | Set `started_at = NOW()` on first form load if null (for future accuracy) |

## Why It Was Blank

The query chain was:
1. `.eq("status", "completed")` -- 7 rows match
2. `.not("updated_at", "is", null)` -- still 7 rows
3. `.not("started_at", "is", null)` -- **0 rows** (no inspection has `started_at` set)
4. Empty array returned, function returns `0`, card displays "0h"

The fix removes the impossible filter, making the metric immediately functional with the 7 completed inspections in the database.

