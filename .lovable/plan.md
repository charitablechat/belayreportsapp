

## Fix: Dashboard Shows Zero Data After Navigating Back from Reports

### Root Cause Analysis

Despite the previous session-gating fix, the Dashboard still shows zeros because of three remaining gaps:

**Gap 1 — `ensureValidSession()` gives up when `getSession()` returns null (line 401-403 of cached-auth.ts).** On iOS Safari, after 10+ minutes in a report form, the in-memory session can be garbage-collected. `getSession()` returns `null`, but the **refresh token in localStorage is still valid**. The function returns `null` immediately without attempting `refreshSession()`, so `sessionValid = false` and all network queries are skipped.

**Gap 2 — The 3-second timeout on session validation is too aggressive.** `refreshSession()` makes a network round-trip that can take 2-4 seconds on mobile. The `Promise.race` resolves to `null` before the refresh completes, producing `sessionValid = false`.

**Gap 3 — No retry mechanism.** When session validation fails (timeout, transient error), `refreshReports` makes exactly one attempt and then stops. The user is left with stale or empty data.

**Combined effect:** User navigates back → Dashboard mounts → sessionStorage cache may be expired → `ensureValidSession` fails → `sessionValid = false` → network queries skipped → IndexedDB 2s timeout may return `[]` → user sees zeros.

### Changes

#### 1. `src/lib/cached-auth.ts` — Attempt `refreshSession()` when `getSession()` returns null

When `getSession()` returns no session but we're online, try `refreshSession()` using the stored refresh token before giving up:

```typescript
// Current: returns null immediately
if (!session) {
  console.warn('[CachedAuth] No active session for sync');
  return null;
}

// Fixed: try refresh first
if (!session) {
  if (navigator.onLine) {
    const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
    if (refreshed) {
      cachedUser = refreshed.user;
      cacheTimestamp = Date.now();
      return refreshed.user;
    }
  }
  return null;
}
```

#### 2. `src/pages/Dashboard.tsx` — Increase session validation timeout from 3s to 8s

Mobile networks routinely need 3-5 seconds for auth round-trips. The current 3s timeout causes false negatives:

```typescript
// Change from 3000 to 8000
const sessionUser = await Promise.race([
  ensureValidSession(),
  new Promise<null>(resolve => setTimeout(() => resolve(null), 8000))
]);
```

#### 3. `src/pages/Dashboard.tsx` — Add session retry with delay

If the first session validation fails while online, wait 2 seconds and retry once. This handles transient network blips and iOS Safari's delayed connectivity restoration:

```typescript
if (!sessionValid && navigator.onLine) {
  await new Promise(r => setTimeout(r, 2000));
  try {
    const retryUser = await Promise.race([
      ensureValidSession(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 5000))
    ]);
    sessionValid = !!retryUser;
  } catch {}
}
```

#### 4. `src/pages/Dashboard.tsx` — Never overwrite existing state when session is invalid

When `sessionValid` is false, the load functions should never touch state if data already exists on screen. Currently, if both network and offline return empty, the cache-initialized state is preserved. But there's an edge case: if offline returns `[]` due to timeout and `sessionValid` is false, `setInspections(prev => prev.length === 0 ? offlineData : prev)` sets `[]`. Add a guard:

```typescript
// In the offline-data-only path (when sessionValid is false):
if (offlineData.length > 0) {
  setInspections(prev => prev.length === 0 ? offlineData : prev);
}
// If offlineData is also empty, do NOT touch state — preserve whatever cache had
```

#### 5. `src/pages/Dashboard.tsx` — Write cache on every successful data display

Currently `writeDashboardCache` only fires after a successful network fetch. If the user navigates back and sees offline data, that data should also be cached to sessionStorage for the next navigation:

```typescript
// After offline data is set:
if (offlineData.length > 0) {
  setInspections(prev => prev.length === 0 ? offlineData : prev);
  writeDashboardCache('dashboard-cache-inspections', offlineData); // NEW
}
```

This ensures the sessionStorage cache always has the latest known-good data, so the next mount starts with real values instead of `[]`.

### Files Modified
| File | Change |
|------|--------|
| `src/lib/cached-auth.ts` | Try `refreshSession()` when `getSession()` returns null |
| `src/pages/Dashboard.tsx` | 8s timeout, retry mechanism, never-clear guard, cache offline data |

### Impact
- Covers the remaining failure modes: expired in-memory session, slow mobile auth, transient errors
- Zero risk of data loss — changes only prevent premature state clearing
- No performance impact — retry only fires when initial validation fails (edge case)

