

## S33 — Debounce the `online` handler so flaky networks don't stack 5s session refreshes

### Problem

`handleOnline` in `src/hooks/useAutoSync.tsx` (L670–704) does, on every single `online` event:

1. `await supabase.auth.refreshSession()` with a hard 5s timeout race.
2. `await verifyAndReconcileOfflineAuth()` if pending.
3. `triggerDebouncedSync()` (which itself debounces 1.5s).

The *sync* is debounced, but the *session refresh* isn't. On a network that flips online/offline every few seconds (subway, elevator, weak Wi-Fi roam), each flap stacks another 5s refresh, blocks the next refresh from coalescing, and produces user-visible lag plus log noise. The same pattern lives in the `pageshow` handler at L868.

### Fix

Debounce the **outer** handler, not just the sync step. Coalesce a burst of online flaps into one refresh+reconcile+sync pass.

**`src/hooks/useAutoSync.tsx`**

1. Add a sibling ref next to `debounceTimerRef`:
   ```ts
   const onlineHandlerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   ```
   And a constant near `DEBOUNCE_DELAY`:
   ```ts
   const ONLINE_HANDLER_DEBOUNCE = 1500; // coalesce online-event flaps
   ```

2. Split `handleOnline` (L670) into two functions:
   - **`runOnlineReconcile`** — the existing body (refresh + reconcile + `triggerDebouncedSync`), unchanged.
   - **`handleOnline`** — schedules `runOnlineReconcile` via `onlineHandlerTimerRef` after `ONLINE_HANDLER_DEBOUNCE`. If another `online` event fires before the timer expires, clear and reschedule. Also short-circuit to no-op if `!navigator.onLine` at fire time (we went offline again before the timer expired — wait for the next stable online).

3. Same pattern for the `pageshow` handler at L868: route through the same debounced scheduler so a quick app-resume → re-suspend → resume burst doesn't double-refresh.

4. In the unmount cleanup at L988–1018, also `clearTimeout(onlineHandlerTimerRef.current)`.

5. Drop the redundant 5s `Promise.race` timeout for `refreshSession` — once the handler is debounced, only one refresh runs per stable transition, and `supabase.auth.refreshSession()` already has its own internal abort behavior. Keep the try/catch and the warn log. (Optional; if reviewer prefers belt-and-suspenders, keep the race — the win is removing repetition, not removing the timeout itself.)

### Out of scope

- Retry/backoff inside `refreshSession` — separate concern (Phase 2 auth-bridge owns reconcile retries).
- The Realtime-event debouncer (`triggerDebouncedSync`) — already correctly debounced.

### Risk

Negligible. The 1.5s extra delay on a stable online transition is invisible against the existing 1.5s sync debounce that already runs after refresh. The win on flaky networks is bounded: at most one outstanding refresh+reconcile pass, regardless of how many flaps occurred.

### Verification

- `npx tsc --noEmit`.
- Manual: with DevTools Network throttling, toggle Offline → Online 5× in 2s, confirm only one `[AutoSync] Network reconnected` log fires (not 5).
- Manual: confirm a single offline→online transition still syncs within ~3s (1.5s outer debounce + 1.5s inner sync debounce).
- Regression: online → leave online 10s → manual sync still works as before.

