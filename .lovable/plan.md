

## Why the badge is stuck at "1 pending"

**Not** a regression of fixes A/B/C. They worked. This is a separate, pre-existing logic bug that the cleaner logs now make obvious.

### The actual bug

There are **two different quarantine systems** for daily assessments, and they disagree:

1. **IDB quarantine** (`_remote_deleted_at` flag) — set when the server has soft-deleted a row but the local copy has unsynced edits. `getUnsyncedDailyAssessments` correctly **excludes** these via `isNotQuarantined` (line 3205 of `offline-storage.ts`).

2. **Session quarantine** (`sync-quarantine.ts`, `sessionStorage`) — set after 3 consecutive failed sync attempts. `atomic-sync-manager.ts:2958` calls `filterQuarantined(unsynced)` which **drops** the record from the sync batch but **does not** flag it in IDB.

Assessment `c24b6198-4a5...` is in **session quarantine, not IDB quarantine**. So the round-trip every cycle is:

```
getUnsyncedDailyAssessments      → returns [c24b6198]          (total: 1)
filterQuarantined (in sync)      → drops c24b6198               (dropped: 1)
sync proceeds with 0 records     → success
getUnsyncedDailyAssessments      → still returns [c24b6198]    (total: 1)  ← badge stays "1 pending"
```

The badge will stay at "1 pending" until either (a) end of UTC day when the session quarantine expires and the next sync attempt either succeeds or re-quarantines, or (b) the browser session ends. From the user's perspective: **permanent stuck badge, no way to act on it, no UI surface to tell them why.**

### What's wrong about it

A user-visible "pending" count should mean "things the system will try to sync." A session-quarantined record is, by design, **not going to be synced this session**. Counting it lies to the user and triggers the "Keep the app open" banner forever for an item that the app has already given up on.

### Fix — small and contained

**Fix E — exclude session-quarantined records from the unsynced count.**

Two parts:

1. **`getUnsyncedDailyAssessments` / `getUnsyncedTrainings` / `getUnsyncedInspections`** (`src/lib/offline-storage.ts`): after the existing ownership + drift filter, drop any record whose `id` is currently quarantined per `sync-quarantine.isQuarantined(id)`. Keep the existing `isNotQuarantined(record)` IDB-flag check; this adds the session-flag check on top.

2. **`sync-quarantine.ts`**: export a small `isQuarantined(id: string): boolean` helper that reads the session map and returns `true` only if `quarantinedUntil > Date.now()`. (Currently the file has `recordSyncFailure` / `filterQuarantined` but no single-id read.)

That's it. Once Fix E ships:
- The badge drops to 0 the moment the assessment hits its 3rd failure.
- The "Keep the app open" banner disappears.
- The session quarantine still works exactly the same way inside the sync pipeline — we're only changing what the *count* surfaces.

### Surface the quarantined record somewhere

The user still has an assessment that the system has given up on. Right now there's no UI that tells them. Two options, pick one:

- **(i) Cheap**: add a `quarantinedAssessmentCount` field to `usePWA` and surface it in the existing Sync Terminal sheet under a new line: `QUARANTINED 1 — sync paused until tomorrow (tap to retry now)`. Tap clears the session entry for that id and forces a sync.
- **(ii) Proper**: extend `SyncDiagnosticsSheet` (already exists) to list quarantined ids with a per-row "Retry now" button. More code, better UX.

Recommend **(i)** — uses existing UI surface, ~30 lines.

### Confirmation reads I want to do before writing code

- `sync-quarantine.ts` lines 80–172 to confirm the cleanup/expiry semantics so `isQuarantined` matches them exactly.
- `usePWA` / `useAutoSync` to see where `unsyncedCount` is composed for the badge.
- `BackgroundSyncStatus.tsx` and `SyncPulse.tsx` for where to surface the quarantined count without crowding the layout.

### Out of scope this round

- Why assessment `c24b6198-4a5...` is failing in the first place (could be schema, RLS, network, or a stale FK). Worth a separate look — `[Atomic Sync]` would have logged the failure 3 cycles ago. But fixing the root cause and fixing the misleading badge are independent.
- The 146-suppressed-timeouts pattern in the current logs — same hot store as before; Fix A reduced it, but it's still elevated. Not the badge issue, separate quality-of-implementation work (Fix D candidate).

### Memory updates after the fix

- New: `mem://constraints/quarantine-vs-pending-count` documenting that session-quarantined items must not appear in the user-facing pending count.
- Update `mem://architecture/unsynced-counts-coalescer` to add the session-quarantine filter rule.

### Verdict

Approve and I'll switch to default mode, do the three confirmation reads, ship Fix E + option (i) Sync Terminal surfacing, and leave the underlying assessment failure for a follow-up.

