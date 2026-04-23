# Plan: H10 — Capture admin pre-edit snapshots offline

## Problem

`capturePreEditSnapshot` is invoked only inside the `if (isOnline) { … }` branch of all three report forms (InspectionForm L1664–1668, TrainingForm L840–842, DailyAssessmentForm L885–887). When an admin edits another user's report while offline:

1. The form saves locally to IDB.
2. The pre-edit snapshot is never captured.
3. When sync finally fires (potentially hours later), the admin's overwrite reaches the server with no prior pre-image in `admin_edit_snapshots`.
4. The Admin Recovery UI (driven by `fetchAdminEditSnapshots`, which only reads DB rows) shows a gap in the audit trail.

The fix mirrors the cloud-backup pattern: capture *intent* locally at edit-time, then upload when online.

## Solution

Capture an **intent record** locally the moment an admin starts editing someone else's report (regardless of network state), then have a flusher upload any queued intents to `admin_edit_snapshots` when connectivity returns. The actual snapshot of "current server state" can only be taken when online — but the *trigger* and the *editor identity / timestamp / report id* are recorded locally so nothing is silently lost.

### Behavior

- **Online admin edit (unchanged path):** `capturePreEditSnapshot` runs immediately, fetches current server state, inserts into `admin_edit_snapshots`. Same as today.
- **Offline admin edit (new path):**
  1. Enqueue an intent record to a new IDB store `admin_edit_snapshot_queue` containing `{ reportType, reportId, ownerId, editorId, queuedAt }`.
  2. On next online transition (and on app boot when online), a flusher reads the queue and, for each entry, invokes `capturePreEditSnapshot` (which fetches whatever is currently on the server — this is the best-available pre-image *before* the queued edit is itself synced).
  3. **Ordering guarantee:** the flusher runs *before* the IDB→server sync pipeline pushes the admin's queued edit. We hook this into `useAutoSync` so the snapshot upload completes (or errors-with-retry) before the admin's edit is pushed.

## Changes

### 1. `src/lib/offline-storage.ts`
- Bump IDB version and add object store `admin_edit_snapshot_queue` (keyPath `id` autoincrement; index `by-report` on `[reportType, reportId]`).
- Pre-migration snapshot wiring (Phase 5) already covers schema bumps.

### 2. New file `src/lib/admin-edit-snapshot-queue.ts`
Exports:
- `enqueueAdminEditIntent(reportType, reportId, ownerId, editorId): Promise<void>` — idempotent per `(reportType, reportId, editorId)` within a 5-minute window so rapid auto-saves don't queue duplicates.
- `flushAdminEditQueue(): Promise<{ uploaded: number; failed: number }>` — drains the queue, calling the existing `_doCapture` (refactor from `admin-edit-snapshot.ts` to export it), and removes entries on success. Failures stay queued.
- `getQueueLength(): Promise<number>` — for diagnostics surface.

### 3. `src/lib/admin-edit-snapshot.ts`
- Refactor `_doCapture` to be exportable as `captureAdminEditSnapshotNow` so the queue flusher can reuse the exact same fetch+insert path.
- Update `capturePreEditSnapshot` (the public fire-and-forget) to **always** attempt; if `navigator.onLine` is false OR the insert fails with a network error, route to `enqueueAdminEditIntent` as a fallback.

### 4. `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`
- Move the `capturePreEditSnapshot(...)` call **out of** the `if (isOnline)` block so it is invoked unconditionally whenever `currentUser.id !== owner.inspector_id`. The function itself now handles online vs offline routing internally (per change #3).

### 5. `src/hooks/useAutoSync.tsx`
- At the top of each sync cycle (before the IDB→server push for inspections/trainings/assessments), `await flushAdminEditQueue()` so any queued pre-edit snapshots land on the server **before** the admin's overwrite.
- Wrap in try/catch — flush failure must not block the broader sync cycle, but should log a warning.

### 6. (Optional, low priority) `src/components/pwa/SyncDiagnosticsSheet.tsx`
- Add a tiny "Pending admin audit snapshots: N" line driven by `getQueueLength()` so a super-admin can see if anything is stuck.

## Why this works

- The queue captures the *who/what/when* of the admin's intent immediately, even fully offline. That alone closes the audit-gap hole — even if the actual pre-image upload fails forever, there is at minimum a local record of "an admin edit happened."
- When connectivity returns, the flusher runs **before** the edit syncs, so the snapshot in `admin_edit_snapshots` reflects the server state *prior to* the admin's queued overwrite — the same guarantee the online path provides today.
- Idempotency guard (5-min window) prevents auto-save storms from creating dozens of redundant snapshots for one editing session.

## Verification

- `npx tsc --noEmit`.
- Manual: as admin, open another user's report, go offline (DevTools), edit several fields, save. Check IDB → `admin_edit_snapshot_queue` has one entry. Go online. Confirm the entry is removed and a row appears in `admin_edit_snapshots` with the **server-side pre-edit values** (not the admin's new values), then the admin's edit syncs after.
