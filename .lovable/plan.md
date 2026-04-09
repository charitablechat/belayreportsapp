

# Fix: Invoiced Tab Blinking and Showing 0 Reports

## Root Cause

Two interrelated issues:

1. **Dual-state anti-pattern**: The invoiced report IDs are fetched via React Query but then mirrored into a separate `useState` (`invoicedReportIds`) via a side-effect call to `setInvoicedReportIds(ids)` inside the `queryFn`. This creates a race condition — the React Query data arrives, but the `useState` update is batched and may not be reflected in the same render cycle. Meanwhile, `invoicedReportIds` starts as an empty `Set`, causing the invoiced memo to return `[]`.

2. **Constant refetching**: The invoiced query has `staleTime: 0` combined with multiple refetch triggers (`handleWindowFocus`, `handleVisibilityChange`, sync-complete, etc.). Every window focus event refetches the query AND triggers `refreshReports`, causing rapid cascading re-renders where the invoiced data momentarily appears empty between state updates — producing the "blinking" effect.

There are 3 invoiced records in the database that should be visible.

## Changes

### File: `src/pages/Dashboard.tsx`

1. **Use React Query data directly** — Remove the `invoicedReportIds` `useState` and derive it from the query's `data` return value instead:
   - Change the `useQuery` to return the `Set<string>` directly (instead of raw data + side-effect `setState`)
   - Use `const invoicedReportIds = invoicedQuery.data ?? new Set<string>()` as a stable derived value
   - Remove the `useState<Set<string>>(new Set())` line

2. **Set a reasonable `staleTime`** — Change from `0` to `30_000` (30 seconds) to prevent constant refetching on every focus/visibility event. The data is explicitly refetched via `refetchInvoiced()` when toggling invoiced status anyway.

3. **Update `handleToggleInvoiced`** — Instead of calling `setInvoicedReportIds` for optimistic updates, do optimistic updates via React Query's `queryClient.setQueryData` so the single source of truth stays in React Query cache.

4. **Guard the Invoiced tab content** — While `invoicedReportIds` is loading (query is in `isLoading` state), show skeletons instead of the empty state. Pass `isLoading` status alongside existing `loading` prop check.

### Summary
~20 lines changed in `Dashboard.tsx`. Eliminates the dual-state race condition and stops the refetch storm that causes the blinking empty state.

