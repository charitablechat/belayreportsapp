

# Fix: Daily Assessment Sync Timeout

## Problem

The sync is not "slow" -- it is **failing and retrying in a loop**. The console logs show:

```
Step timeout: upsert:daily_assessments
Transaction failed after 0/8 steps. Rollback: successful
```

The stuck record (`b840ebe8...` / "Santa's Workshop") is **1.9 MB** -- an unusually large row. The current per-step timeout of 8 seconds is too short to upload nearly 2 MB of JSON to the database, so it times out on the very first step, rolls back, and retries endlessly.

## Solution

Increase the step timeout in `transaction-manager.ts` from 8 seconds to 15 seconds. This gives large records enough time to complete the upsert while still protecting against genuinely hung operations.

8 seconds is reasonable for small records but insufficient for payloads approaching 2 MB on mobile or slower connections. 15 seconds provides a comfortable margin without risking the overall sync timeout (which caps at 5 minutes).

## Technical Change

| File | Change |
|------|--------|
| `src/lib/transaction-manager.ts` | Line 4: Change `STEP_TIMEOUT` from `8000` to `15000` |

## Why This is Safe

- The overall sync timeout (dynamic, max 5 minutes) already caps total sync duration
- The safety timeout in `useAutoSync` force-resets state if the entire sync hangs
- 15 seconds is still well under the 30-second base sync timeout, so a single slow step won't cascade into a full timeout
- Rollback behavior is unchanged -- if a step genuinely fails, it still rolls back correctly

