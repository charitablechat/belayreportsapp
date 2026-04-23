

## S21 — Replace `setInterval` polling with a shared completion promise

**Goal.** Eliminate the 500 ms / 15 s polling loop in `performSync`. When a second sync is requested while one is in flight, the caller should `await` the in-flight run directly and either return its result or trigger a follow-up — no polling.

### Design

Add a ref `inFlightSyncRef: { current: Promise<void> | null }`. The runner assigns it at the very start of `performSync` and clears it in `finally`. Any concurrent caller that finds `syncInProgressRef.current === true` simply awaits `inFlightSyncRef.current` instead of polling.

Behavior matrix preserved:

- **No sync running** → start one as today.
- **Sync running, caller is auto-trigger (silent)** → `await inFlightSyncRef.current` and return; do not start a follow-up. (Matches today's "skip if already syncing" intent for background polls.)
- **Sync running, caller is user-initiated (force=true)** → `await inFlightSyncRef.current`, then immediately start a fresh `performSync(true)` so the user's explicit "sync now" tap is honored against post-edit state.

This removes the 15 s timeout entirely — the await resolves exactly when the sync ends, no earlier and no later. The S18 safety timeout already guarantees the in-flight promise eventually resolves even if the sync stalls (it flips `syncInProgressRef` and `setSyncInProgress(false)`); we mirror that by ensuring the promise also resolves in the safety-timeout branch.

### Files

- **`src/hooks/useAutoSync.tsx`**
  - Add `const inFlightSyncRef = useRef<Promise<void> | null>(null);`
  - Replace the lines 178–191 `setInterval` block with:
    ```ts
    if (syncInProgressRef.current && inFlightSyncRef.current) {
      try { await inFlightSyncRef.current; } catch {}
      if (force) {
        // user explicitly asked — run again against post-sync state
        return performSync(true);
      }
      return; // silent caller: in-flight run covered them
    }
    ```
  - Wrap the actual sync body in a `Promise<void>` assigned to `inFlightSyncRef.current` at the top of `performSync` (right after we claim `syncInProgressRef.current = true`), and clear it (`inFlightSyncRef.current = null`) in the existing `finally` block alongside the other resets.
  - Ensure the safety-timeout fallback (S18) also clears `inFlightSyncRef.current` so awaiters unblock.

### Out of scope

- Changing the cross-tab sync coordination (BroadcastChannel / leader election) — this is purely intra-instance.
- Surfacing a "sync queued" toast — silent skip behavior is preserved.

### Risk

Low. The completion promise is strictly more responsive than the 500 ms poll and never waits longer than the sync itself. The only behavior change is the `force=true` re-entry path, which today silently no-ops after the poll wins — now it properly honors the user's explicit request. If undesired, we can drop the `force` re-trigger and just `await` + return for all callers.

### Verification

`npx tsc --noEmit`, then a manual smoke: tap the manual "Sync now" button twice in rapid succession and confirm no `[AutoSync]` polling logs and that both calls resolve cleanly.

