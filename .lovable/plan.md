

# Realtime Channel Auto-Recovery

## Problem
When the Realtime channel hits 3 consecutive errors, the circuit breaker permanently kills the channel for the rest of the session. There is no recovery mechanism — even if the network stabilizes, the app stays on slow polling (30-180s) until the user refreshes the page.

## Solution
Add a timed auto-reconnect after the circuit breaker trips. After unsubscribing, wait 60 seconds, then attempt to re-establish the Realtime channel. If it fails again (3 more errors), back off to 2 minutes, then 5 minutes (exponential backoff, capped). This ensures Realtime self-heals without requiring a page refresh, while still protecting against reconnect storms.

## Changes

### File: `src/hooks/useAutoSync.tsx`

1. **Add a reconnect timer ref** alongside the existing `realtimeErrorCountRef` and `channelRef`:
   - `realtimeReconnectTimerRef` (NodeJS.Timeout)
   - `realtimeBackoffRef` (number, starts at 60000, doubles on each trip, caps at 300000)

2. **Modify the circuit breaker block** (lines 697-703): After unsubscribing, schedule a reconnect attempt using `setTimeout` with the current backoff value, then double the backoff.

3. **Extract channel setup into a reusable function** (`setupRealtimeChannel`) so it can be called both on mount and during reconnect. This function will contain the current `.channel()...subscribe()` logic from lines 675-707.

4. **On successful SUBSCRIBED**: Reset both `realtimeErrorCountRef` and `realtimeBackoffRef` back to initial values (0 and 60000).

5. **Cleanup**: Clear the reconnect timer in the effect cleanup (lines 709-732).

### Behavior Summary

```text
Error 1-2:  Logged, no action
Error 3:    Unsubscribe channel, schedule reconnect in 60s
Reconnect → Error 3 again: Schedule reconnect in 120s
Reconnect → Error 3 again: Schedule reconnect in 300s (cap)
Reconnect → SUBSCRIBED:    Reset all counters, back to normal
```

No database changes needed. Polling continues as fallback during reconnect waits.

