

## S39 — Surface dead-letter & regression-skip state in the UI

### Finding

Both safety ceilings now exist but only one has any UX surface:

| Constant | Where it lives | Current UI visibility |
|---|---|---|
| `MAX_PHOTO_RETRIES = 5` | `offline-storage.ts:1646` | ✅ Already surfaced — `SyncDiagnosticsSheet` lists each stuck photo with retry count, last error, retry/discard buttons. `SyncPulse` shows count + bulk retry. |
| `MAX_REGRESSION_SKIPS = 3` | `atomic-sync-manager.ts:147` | ❌ **None.** When a record's field count drops >50% the sync is silently blocked, only `console.error` logs it. The user sees their report stuck in "Pending" with zero explanation. After 3 cycles the guard releases on its own — still silent. |

So the actual gap S39 names is **regression-skip visibility**. Photo dead-letter UX is fine; we just expose the constant alongside it for parity.

### Changes

**1. `src/lib/regression-skip-store.ts` — add a list helper**

Add a `listRegressionSkips()` function that returns all non-expired counter rows so the diagnostics UI can render them. Pure read; uses the same DB handle and TTL filter.

```ts
export interface RegressionSkipEntry {
  id: string;            // record id (inspection/training/assessment)
  count: number;         // current skip count
  lastIncrementAt: number;
}
export async function listRegressionSkips(): Promise<RegressionSkipEntry[]>
```

**2. `src/lib/atomic-sync-manager.ts` — emit a notification on first block**

In all three regression-skip branches (inspection L473, training L1345, assessment L2142), when `skipCount === 1` (first block in a chain), push a notification via the existing `notification-center` so the user sees "Sync paused: <Org name> — large drop in data detected (auto-resumes after 3 cycles)". Look up the org/title from the inspection/training/assessment record we already have in scope. No-op on cycles 2–3 (avoid spam) and on auto-release.

Also export `MAX_REGRESSION_SKIPS` so the UI can label "(N of 3)".

**3. `src/components/pwa/SyncDiagnosticsSheet.tsx` — new "Held-Back Records" section**

Below the existing "Stuck Photos" / "Failed Deletions" sections, add a third section that calls `listRegressionSkips()` on sheet open (in the existing `refresh()`):

```
Held-Back Records (N)
─────────────────────
<id-prefix-8> · attempts: 2 of 3
"Sync paused — large data drop detected. Will auto-retry."
[ Force retry now ]   [ Reset counter ]
```

- **Force retry now**: calls `resetRegressionSkipCount(id)` and triggers `forceSync()` — the next pass will allow sync regardless of drop %.
- **Reset counter**: calls `resetRegressionSkipCount(id)` only (next normal cycle decides). 
- Title resolution: best-effort lookup against `getOfflineInspection/Training/DailyAssessment` for the org name; fall back to the 8-char id prefix if not found.

**4. `src/components/pwa/SyncPulse.tsx` — terminal-style row**

Add a `HELD_BACK` line to the terminal sheet when the count > 0:

```
HELD_BACK    2
▸ Tap diagnostics for details
```

No interactive UI here — keep SyncPulse as the at-a-glance summary; deep actions stay in `SyncDiagnosticsSheet`. Wire the count via a small read of `listRegressionSkips().length` inside the existing `usePWA`/`useUnsyncedPhotos` flow (cheapest: surface it through `useUnsyncedPhotos` since that already polls every 5 min and on `sync-photos-updated`; add a sibling event `sync-records-updated` dispatched by atomic-sync-manager on regression block/release/clear).

**5. `src/hooks/useUnsyncedPhotos.tsx` — extend with regression count**

Add `regressionSkipCount: number` and `regressionSkipEntries: RegressionSkipEntry[]` to the returned status. The hook already fetches on mount, on `sync-photos-updated`, and on a 5-min tick — add a `sync-records-updated` listener for the new event. Rename the hook later if scope creeps; for S39 keep the file to minimize blast radius.

### Out of scope

- Renaming `useUnsyncedPhotos` → `useSyncBacklog` (worth doing eventually; not S39).
- Any change to the 50% / 3-cycle thresholds themselves.
- Surfacing `MAX_PHOTO_BATCH_SIZE` or `MAX_SOFT_DELETE_ATTEMPTS` (separate tickets if needed; user only flagged photo + regression).
- Push notifications. The in-app notification center is enough — push is a heavier-touch decision.

### Risk

Low. New read paths are best-effort with try/catch. The notification on first block is the only behavior change in the sync hot path and is wrapped in a `.catch(() => {})` so a notification-center failure never blocks sync. Existing dead-letter UI is untouched.

### Verification

- `npx tsc --noEmit`.
- DEV: artificially shrink an inspection's field count >50% (delete most rows in DevTools), trigger sync, confirm:
  - Notification appears: "Sync paused: <Org> — large drop detected".
  - `SyncDiagnosticsSheet` shows the record under "Held-Back Records (1 of 3)".
  - `SyncPulse` shows `HELD_BACK 1` in the terminal.
  - "Force retry now" syncs the record on the next pass.
  - "Reset counter" clears the row from the diagnostics list.
- DEV: trigger 3 regression cycles in a row, confirm only one notification fires (cycle 1) and the record auto-releases on cycle 4.
- DEV: retry an exhausted photo (existing flow) still works unchanged.

