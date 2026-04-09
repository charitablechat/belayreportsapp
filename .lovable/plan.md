
# Fix: Invoiced Reports Not Appearing in the Invoiced Tab

## Problem
When a report is marked as invoiced from the report form page (e.g., the Southwest inspection), the dashboard's invoiced tab doesn't reflect the change. Two issues:

1. **Stale query cache**: The `invoiced-reports` query has `staleTime: 60s` and is never explicitly refetched when returning to the dashboard.
2. **No cross-page invalidation**: The `useInvoicedStatus` hook (used in report forms) doesn't invalidate the React Query cache, so the dashboard never learns about the change.

## Changes

### 1. `src/hooks/useInvoicedStatus.tsx`
After a successful toggle (insert or delete), invalidate the `invoiced-reports` React Query cache so the dashboard picks up the change on next mount:

```tsx
import { useQueryClient } from "@tanstack/react-query";
// In the hook:
const queryClient = useQueryClient();
// After successful toggle:
queryClient.invalidateQueries({ queryKey: ["invoiced-reports"] });
```

### 2. `src/pages/Dashboard.tsx`
- Reduce `staleTime` on the `invoiced-reports` query to `0` (or remove it) so it always refetches on remount/focus.
- Alternatively, add `refetchOnMount: 'always'` to ensure the invoiced IDs are fresh whenever the dashboard loads.

### 3. `src/pages/Dashboard.tsx` — `handleToggleInvoiced`
After the optimistic state update, also call `refetchInvoiced()` to keep the React Query cache in sync for consistency.

## Why This Fixes It
Currently, marking a report invoiced from the form page writes to the database but the dashboard query cache remains stale. By invalidating the query on toggle and ensuring the dashboard refetches on mount, the invoiced tab will always show the correct reports.
