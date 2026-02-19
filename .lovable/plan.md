

# ✅ COMPLETED: Fix Avg Completion Time Card

## What was done

1. **Removed broken `.not("started_at", "is", null)` filter** in SuperAdminDashboard.tsx — the query now returns all completed inspections with a non-null `updated_at` in the last 30 days.

2. **Enhanced hover details** — the StatCard now shows fastest, slowest, sample size, and a clearer description noting the 30-day window.

3. **Set `started_at` on first form open** in InspectionForm.tsx — when an owner opens an inspection for the first time, `started_at` is populated alongside `last_opened_at`. Future inspections will have accurate start timestamps.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/SuperAdminDashboard.tsx` | Removed broken filter; enriched query to return min/max/count; updated StatCard hover content |
| `src/pages/InspectionForm.tsx` | Set `started_at = NOW()` on first load if null |
