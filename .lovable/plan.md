

## Plan — fix `idb_read_timeout` in Sync Terminal

### Root cause (from console logs)

Two compounding issues:

1. **Drift-flagged stragglers in a loop.** 5 inspections (`13a244aa`, `5b8b5184`, `a010d727`, `c69984a6`, `da9de935`) are flagged as drift-unsynced on every cycle but filtered out before transmission (final `total: 0`). They never resolve, so every sync cycle re-scans and re-logs them. Drift ranges from 33 minutes to 18 days.

2. **5s IDB timeout too tight.** `[Offline Storage] Operation timed out after 5000ms (295 similar warnings suppressed)` — the store is heavy enough that individual reads blow the 5s budget. When `getUnsyncedInspections` itself times out, `IdbReadFailure` propagates and `useAutoSync` shows `idb_read_timeout` in the Sync Terminal even though the sync as a whole "completes" with `total: 0`.

### Confirmation reads (default mode, before any writes)

1. `src/lib/offline-storage.ts` — find the `withIDBTimeout` definition + the `'heavy'` budget constant, and the `getUnsyncedInspections` body to see what triggers the drift log.
2. `src/hooks/useAutoSync.tsx` — find where `IdbReadFailure` from the unsynced-counts read becomes `syncError = 'idb_read_timeout'` (the string the terminal renders).
3. Quick check: are these 5 inspections owned by the current user (`759e973e...`) or by someone else? The `total: 0` after filtering suggests they're filtered by `inspector_id !== currentUserId`. If so, the drift log is pure noise — they shouldn't be evaluated at all.

### Fixes (in priority order, all small)

**Fix A — Stop re-evaluating drift on records the user doesn't own.**
In `getUnsyncedInspections`, filter by `inspector_id === userId` *before* the drift check, not after. This eliminates the 5 phantom drift logs per cycle and the IDB load they cause. Same fix for `getUnsyncedTrainings` and `getUnsyncedDailyAssessments`. **Biggest win — drops the 295 timeouts/cycle dramatically.**

**Fix B — Suppress noisy drift logs after first-seen.**
Once a record has been logged as drift-unsynced, don't log it again for the same session unless the drift value changes. In-memory `Set<id>` keyed by `${id}:${drift_ms_bucket}`. Pure logging change, no behavior change.

**Fix C — Promote the surfaced error message.**
Right now any `IdbReadFailure` shows the raw string `idb_read_timeout`. Map it to a user-friendly variant:
- If the underlying sync succeeded but counts read failed → `"Sync ran, but local stats are stale — refresh to recheck"` and **do not** flip the badge to "SYNC FAILED".
- Only show "SYNC FAILED" when the sync pipeline itself failed.

**Fix D (optional, if A+B+C aren't enough) — Bump the `'heavy'` IDB timeout from 5s to 10s** *only* for the unsynced-counts reads, not for everything. Tight timeouts elsewhere are deliberate.

### Out of scope this round

- Resolving the 5 drift-flagged inspections themselves (they're owned by another user; not this user's problem to fix).
- The 295-suppressed-timeouts pattern (separate quality-of-implementation issue; A reduces the count, B+C make it invisible).
- Changing the C2 architecture (full-scan + filter) — that's working as designed.

### Memory updates

- Add `mem://constraints/sync-terminal-error-classification` distinguishing pipeline failure from counts-read failure.
- Update `mem://architecture/unsynced-counts-coalescer` with the "filter by owner before drift check" rule.

### Verdict

Approve and I'll switch to default mode, do the three confirmation reads, then ship Fix A + B + C in one pass. Fix D held in reserve.

