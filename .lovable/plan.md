## M3 — Verify offline-auth-pending on iOS resume paths before syncing

### Problem
`runOnlineReconcile` (the `online` event handler) already calls `verifyAndReconcileOfflineAuth()` before triggering a sync. But three other resume paths kick off `performSync(true)` directly without that check:

1. **`handlePageShow`** (iOS bfcache restore, line 960) — currently routes to `handleOnline()`, which is debounced 1s+. During that debounce window, nothing prevents another path from syncing first.
2. **`handleFocus`** (iOS focus, line 970) — calls `performSync(true)` directly.
3. **`handleVisibilityChange`** (line 780) — calls `performSync(true)` directly.

If iOS restores the tab with `offline_auth_pending === 'true'` and the synthetic session still in localStorage, `performSync(true)` runs against the deterministic UUID. RLS either rejects the placeholder token (no-op, data stuck) or, worse, races with a half-completed `refreshSession` and writes under the wrong `inspector_id`. Outcomes are nondeterministic.

### Fix
Introduce a small helper inside `useAutoSync.tsx` that runs the reconcile guard before any iOS-resume sync trigger:

```ts
const reconcileThenSync = useCallback(async (force = true) => {
  if (navigator.onLine && hasPendingOfflineAuth()) {
    try { await verifyAndReconcileOfflineAuth(); }
    catch (e) { console.warn('[AutoSync] Reconcile before resume sync failed:', e); }
  }
  performSync(force);
}, [performSync]);
```

Then update all three handlers to await it instead of calling `performSync(true)` directly:

- **`handlePageShow`** — call `reconcileThenSync()` directly (skip the `handleOnline` debounce; bfcache restore is a discrete event, not a flap). Keeps the original guard `event.persisted && navigator.onLine`.
- **`handleFocus`** — replace `performSync(true)` with `reconcileThenSync()`. Preserve the existing `MIN_SYNC_INTERVAL` debounce check.
- **`handleVisibilityChange`** — replace `performSync(true)` with `reconcileThenSync()`. Preserve the `!document.hidden && navigator.onLine` guard.

`hasPendingOfflineAuth` is cheap (one localStorage read), so the gate has negligible cost when no synthetic session exists. When a synthetic session does exist, the reconcile completes before any RLS-bound write — eliminating the deterministic-UUID race.

### Files
- `src/hooks/useAutoSync.tsx` — add `reconcileThenSync` helper, swap three call sites.

### Verification
- `npx tsc --noEmit`
- Manual on iOS Safari: sign in offline (synthetic session), background the app for >30s, return — confirm DevTools shows `[OfflineAuth] Synthetic session created` followed by reconcile success **before** any sync POST. No writes should fire under the deterministic UUID.
