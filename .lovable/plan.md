

## Add Refresh Button to Dashboard

### What's Missing

The dashboard has a Force Sync button (syncs offline data to server) but no button to simply **refresh/reload the report list** from the server. Users need a way to manually pull the latest data without relying on pull-to-refresh (mobile-only) or tab-switching.

### Change

**File: `src/pages/Dashboard.tsx`**

Add a Refresh button next to the existing Force Sync button in the dashboard header (line ~1074). It will call the existing `refreshReports(true)` function with a spinning icon during loading.

```text
Header bar (line 1059-1082):
  [SyncPulse] [pending badge] [NetworkQuality] [ForceSyncButton] [RefreshButton] [SuperAdmin badge]
                                                                   ^^ NEW
```

- Use `RefreshCw` icon (already imported) with `variant="icon"` styling matching `ForceSyncButton`
- Spin icon while `refreshInFlightRef` is true (track via a `isRefreshing` state)
- Tooltip: "Refresh reports"
- Disable during active refresh to prevent spam

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Add a Refresh icon button next to ForceSyncButton that calls `refreshReports(true)` |

