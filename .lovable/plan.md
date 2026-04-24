

## Why "SYNC FAILED" still shows after Fix C

### Root cause

Fix C (last round) renamed the IDB-counts-read failure message to the soft string `"Stats refresh delayed — pending counts may be out of date"` in `useAutoSync.tsx:766`. **But it did not change the severity.** It writes to the same `syncError` field that `SyncPulse.tsx:72` treats as fatal:

```ts
else if (syncError) phase = 'error';   // any truthy → SYNC FAILED
```

So the soft message gets stamped with the hard red `SYNC FAILED` badge. The screenshot is the proof — soft message body, hard red header. The Fix C comment (`useAutoSync:760-762`) literally claims "the Sync Terminal still lights amber via the syncError truthy check" — but it actually lights red.

Also, your task description asked me to ship Fix E + the SyncPulse Quarantined UI, but per the previous turn's summary and a confirmation read those **already shipped** (`src/lib/sync-quarantine.ts:115` exports `isQuarantined`; all three `getUnsynced*` import it; `SyncPulse.tsx:44-55` + `:212-235` render the Quarantined row + RETRY NOW). The two memory files are also already in place. Re-shipping would be duplicate work — what's left is the misclassification fix.

### Why this matters

- Users see **SYNC FAILED** + **LAST_SYNC: Never** for what is actually a successful sync with a delayed stats read.
- Erodes trust in the sync indicator, same failure mode as the "stuck pending count" we fixed last round.
- Defeats the purpose of Fix C (separating pipeline failure from stats hiccup).

### Fix F — separate severity from message

Two-field state instead of one:

1. **`useAutoSync.tsx`**: Add a `syncErrorSeverity: 'fatal' | 'soft' | null` to the state. Set `'soft'` when the counts read fails (current Fix C path). Set `'fatal'` in the existing error catch (`useAutoSync:670` etc.) where the actual sync pipeline blew up.

2. **`PWAProvider` / `usePWA`**: Expose `syncErrorSeverity` alongside `syncError`. Existing consumers that only read `syncError` keep working.

3. **`SyncPulse.tsx`**:
   - Phase machine: `syncError && severity === 'fatal'` → `'error'` (red, SYNC FAILED). `syncError && severity === 'soft'` → keep current phase (synced/idle/unsynced) but render the message in the terminal in **amber**, not red.
   - The terminal's `STATUS` row reflects phase. The `ERR:` row stays — but its color/styling moves from `text-red-400 bg-red-950/30` to `text-amber-400 bg-amber-950/20` when severity is soft.
   - **`LAST_SYNC: Never`** is also wrong on this screen — it means `lastSyncTime` is null because no sync has succeeded *this session* in this account. Confirm: a soft stats hiccup must NOT clear `lastSyncTime`. Quick read confirms it doesn't get cleared anywhere in `useAutoSync` — `Never` is showing because the user genuinely hasn't completed a sync in this session yet (fresh load + counts read raced ahead). That's accurate, leave it.

4. **Other consumers** (`SyncStatusIndicator.tsx:71`): Same treatment — only show "Sync Failed" when `severity === 'fatal'`.

### Confirmation reads I want to do before writing code

- `useAutoSync.tsx` lines 660-720 to find every site that sets `syncError` — each needs an explicit severity. (Stats-refresh = soft. Pipeline catch + per-batch failure aggregation = fatal. Per-record failures that already get retried = no syncError at all.)
- `SyncStatusIndicator.tsx` line 71 + `BackgroundSyncStatus.tsx` to align the same severity rule across all surfaces.
- `PWAProvider.tsx` to confirm the new field gets piped through and falls back safely (default `null`).

### Memory updates

- Update `mem://constraints/sync-terminal-error-classification`: replace "string-only fix" guidance with the two-field severity model. Pipeline failure = fatal red. Stats hiccup = soft amber. Quarantined records = neither (own surface).

### Out of scope this round

- Why the user lands on Dashboard with `LAST_SYNC: Never` — that's a fresh-load timing artifact, not a bug. The first sync hasn't completed yet when the terminal opens.
- The 146-suppressed-timeouts pattern — same Fix D candidate as last round.
- The underlying assessment failure (`c24b6198...`) — still tracked as a follow-up.

### Verdict

Approve and I'll switch to default mode, do the three confirmation reads, then ship Fix F (severity field + amber soft styling in the two surfaces that read it). No work on Fix E or the Quarantined UI — already shipped.

