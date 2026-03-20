

## Fix: Stale "0" Report Counts After Navigation

### Root Cause

When navigating away from Dashboard and back, the component remounts. State initializes to empty arrays (`useState<any[]>([])`), and `loading` is set to `true`. However:

1. **Tab counts always render the array length** (line 296: `Inspections ({totalInspections ?? inspections.length})`). While `loading=true` hides the stats bar, the **tab triggers still show "0"** because `totalInspections` comes from `inspections.length` which is `0` during the fetch.

2. **Race condition with session validation**: The `ensureValidSession()` call has a 3-second timeout. If the session refresh is slow, the data fetch may return empty results (RLS rejects stale tokens), and the safety timeout (8s) forces `loading=false` with empty data.

3. **No data caching between mounts**: Each remount starts from scratch with `[]`. There's no stale-while-revalidate pattern.

### Fix Plan

**File 1: `src/pages/Dashboard.tsx`** — Cache data in sessionStorage for instant display on remount

- On successful data load, persist the three arrays to `sessionStorage` (lightweight, tab-scoped).
- On mount, initialize state from sessionStorage instead of `[]`, so returning to Dashboard immediately shows previous data while fresh data loads in the background.
- Key: `dashboard-cache-inspections`, `dashboard-cache-trainings`, `dashboard-cache-daily`.
- Add a small helper to read/write with a 5-minute TTL to avoid showing very stale data.

**File 2: `src/components/dashboard/DashboardReportsSection.tsx`** — Show loading indicator in tab counts

- When `loading` is true, show a spinner or "…" instead of the numeric count in tab triggers.
- Change line 296 from `Inspections ({totalInspections ?? inspections.length})` to `Inspections ({loading ? '…' : (totalInspections ?? inspections.length)})`.
- Same for Training and Daily tabs.

### Technical Details

The sessionStorage cache approach:
```typescript
// On successful load (after setInspections):
try {
  sessionStorage.setItem('dashboard-cache-inspections', JSON.stringify({
    data: networkData,
    ts: Date.now()
  }));
} catch {}

// On mount (initializer):
const [inspections, setInspections] = useState<any[]>(() => {
  try {
    const cached = sessionStorage.getItem('dashboard-cache-inspections');
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < 5 * 60 * 1000) return data;
    }
  } catch {}
  return [];
});
```

This gives immediate display of previous data while the fresh fetch runs in the background — a stale-while-revalidate pattern without changing the existing manual state management architecture.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Initialize state from sessionStorage cache; persist on successful load |
| `src/components/dashboard/DashboardReportsSection.tsx` | Show "…" in tab counts while loading |

