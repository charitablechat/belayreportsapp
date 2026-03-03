

## Auto-Refresh Recent Reports on Return to Dashboard

### Root Cause

When you navigate back from a report form, the `goBack()` helper calls `navigate(-1)` (browser back). This returns to the **existing** Dashboard history entry with the **same** `location.key`. Since the Dashboard's data-loading effect depends on `[location.key]`, it does NOT re-run -- so the report list stays stale.

The fix already documented in the project's own architecture notes states: "report forms use `navigate('/dashboard')` instead of `navigate(-1)` upon exit" to force a fresh `location.key` and trigger re-fetching. The `goBack()` helper contradicts this by using `navigate(-1)`.

### Fix

**File: `src/lib/navigation.ts`**

Change `goBack()` to always navigate to `/dashboard` instead of using `navigate(-1)`. This ensures every return to the Dashboard creates a new history entry with a unique `location.key`, triggering the data-loading effect.

```text
Before:  navigate(-1)   -> reuses old location.key -> no refetch
After:   navigate("/dashboard") -> new location.key -> data reloads
```

### Visual Loading Indicator

**File: `src/pages/Dashboard.tsx`**

Add a thin, high-contrast loading bar at the top of the reports section that appears during data fetches:

- A 2px-tall black progress bar across the full width of the reports container
- Visible only while `loading` is true
- Monospaced font (`font-mono`) applied to report metadata (date, inspector name, status) in the report cards for the developer-focused aesthetic
- Stark border treatment on the reports section container (`border-2 border-foreground`)

**File: `src/components/dashboard/ReportCard.tsx`**

Apply `font-mono` class to the metadata text elements (date, inspector name) for the monospaced data presentation style requested.

### Summary of Changes

| File | Change |
|------|--------|
| `src/lib/navigation.ts` | `goBack()` always uses `navigate("/dashboard")` |
| `src/pages/Dashboard.tsx` | Add brutalist loading bar at top of reports section |
| `src/components/dashboard/ReportCard.tsx` | Apply `font-mono` to data fields |

### What This Does NOT Change

- No changes to report creation or editing flows
- No changes to the existing pull-to-refresh, sync-complete, or visibility-change refresh mechanisms
- No changes to offline storage or data loading functions

