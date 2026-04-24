---
name: quarantine vs pending count
description: Session-quarantined sync records must NOT appear in the user-facing "pending" badge — surface them separately as "QUARANTINED" with a Retry Now action
type: constraint
---
S41 (Fix E). Two quarantine systems exist for sync records:

1. **IDB quarantine** (`_remote_deleted_at` flag, filtered by `isNotQuarantined`) — server soft-deleted, local has unsynced edits.
2. **Session quarantine** (`sync-quarantine.ts`, sessionStorage) — record failed 3 consecutive sync cycles. The sync pipeline drops it via `filterQuarantined` for the rest of the session.

The user-visible "pending" count must reflect **only** records the system will actually try to sync. Counting session-quarantined records causes:
- A permanently stuck "1 pending" badge.
- A permanent "Keep the app open" banner for an item the system has given up on.
- No actionable signal to the user.

**Rule:** `getUnsyncedInspections`, `getUnsyncedTrainings`, `getUnsyncedDailyAssessments` MUST exclude `sync-quarantine.isQuarantined(record.id) === true`. Surface those records separately (currently in `SyncPulse` Sync Terminal sheet as `QUARANTINED N` with a Retry Now button that calls `clearAllQuarantines()` + `forceSync()`).

**Why:** A "pending" count that lies erodes trust in the sync indicator and burns battery via the iOS "keep app open" behaviour for a no-op task.
