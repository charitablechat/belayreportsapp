

# Sync Audit: Findings and Fix Plan

## Critical Finding: Realtime is Completely Disabled

The `useAutoSync` hook subscribes to Realtime channels on `inspections`, `trainings`, and `daily_assessments` (lines 675-707), but **zero tables are in the `supabase_realtime` publication**. This means:

- Cross-device sync relies **entirely on polling** (30s desktop / 60s mobile when active, 120-180s when idle)
- The Realtime subscription code runs but receives **no events** -- it's dead code consuming a WebSocket connection for nothing
- When you edit a report on one device, the other device won't see it for 30-180 seconds at best

## Secondary Finding: 4 Stale Training Records

4 training records have `updated_at` ahead of `synced_at` by up to 4 days, meaning edits on those records never synced back. This suggests the sync pipeline is silently skipping them (possibly due to field-count regression guards or ownership checks).

## Fix Plan

### Step 1: Enable Realtime for Report Tables
Run a migration to add the three report tables to the Realtime publication:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.inspections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trainings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_assessments;
```

This is safe because RLS policies are enforced on Realtime -- users will only receive change events for rows they have SELECT access to. This alone will make cross-device sync near-instant (sub-second) instead of 30-180 seconds.

### Step 2: Investigate and Fix Stale Training Records
Query the specific stale records and attempt to re-align their `synced_at` timestamps using the existing `align_synced_at` RPC function, which will mark them as synced and stop the system from repeatedly trying (and failing) to sync them.

### Step 3: Reduce Idle Polling Interval (Optional)
The current idle interval (120s desktop, 180s mobile) is conservative. With Realtime enabled, polling becomes a fallback only, so these intervals could stay as-is. No code change needed.

## Technical Details

- **Files modified**: None (database migration only for Step 1)
- **Risk**: Low -- Realtime + RLS is a standard Supabase pattern, and RLS is confirmed active on all tables
- **Impact**: Cross-device sync goes from 30-180 second delay to sub-second

