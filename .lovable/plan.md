## Goal

On Recovery & Sync Health, let the signed-in user pick **any** training report they created on this device/browser — not only pinned/problem trainings — while keeping the page offline-first, read-only, owner-scoped, and trainings-only.

## Current state (verified)

- `src/pages/RecoveryAndSyncHealth.tsx` already merges `listLocalTrainings(userId)` (IDB) with an online-only `trainings` server enrichment, deduped by id, owner-filtered, sorted newest-first. So the page already lists more than just pinned reports.
- Gaps vs. the request:
  1. `listLocalTrainings` reads only the `trainings` IDB store. Reports that exist solely inside an `rw_backup_*` localStorage envelope (the scanner already knows about these) are not surfaced as pickable rows.
  2. Rows don't show trainer name, and there's no quick search for users with many trainings.
  3. Server enrichment doesn't fetch trainer profile, so trainer name is never available even when online.

## Scope (this slice)

Trainings only. No inspections, daily assessments, photos, schema, RLS, RPC, savers, sync engine, SW, version policy, audit trigger, Playwright config, or production data changes. Self-Service Restore (`self_service_fill_missing_training_field`) is **not** touched.

## Changes

### 1. `src/lib/recovery/local-report-index.ts` (read-only, generalize)

- Keep current IDB `trainings` scan, owner filter, soft-delete skip, malformed-row tolerance.
- Add a second pass that walks `localStorage` for `rw_backup_*` envelopes and harvests training ids the same way `scanLocalStorageBackups` does (envelope `id`, `inner.id`, `inner.training_id`, nested `children.summary[].training_id`).
  - For each new id not already in the IDB result, push a `LocalReportEntry` with:
    - `displayName` from envelope `organization` / `location` / fallback `"Training (local backup)"`
    - `subLabel` from envelope `start_date` / `training_date` + `"local backup only"`
    - `localOnly: true`, `updatedAt` from envelope `timestamp`
  - Wrap in try/catch per envelope; never throw.
- Extend `LocalReportEntry` with optional fields used by the UI: `trainerName?: string | null`, `startDate?: string | null`, `status?: string | null`. Populate from IDB row when present (no new server calls here).
- Preserve the structural read-only guardrails — no new imports beyond `@/lib/offline-storage`, no write tokens. The existing read-only test continues to pass.

### 2. `src/pages/RecoveryAndSyncHealth.tsx`

- Extend the online-only server enrichment query to also select `trainer_id` (already selects `inspector_id`), then resolve trainer display name via a single batched `profiles` SELECT keyed by the union of `trainer_id` and `inspector_id`. RLS-scoped read; failures soft-fail to `null`. (Read-only — no writes.)
- Merge trainer name into each entry's optional `trainerName`.
- Add a small controlled text input above the list: *"Search by camp, trainer, or date"*. Client-side filter over `displayName`, `trainerName`, `subLabel`, and `startDate`. Empty input = show everything (current behavior).
- In `ReportRow`, render trainer name (when known) and a clearer pair of badges: *On this device only* / *On server* + existing *Flagged for recovery*. No behavior changes to **Check this report**, findings, or Fill flow.
- Keep pinned rows visible and at the top by tweaking the existing sort (pinned first, then newest `updatedAt`). They are no longer the only rows shown — they were never the only rows shown, this just makes the ordering explicit.

### 3. Tests

- `src/lib/__tests__/local-report-index.test.ts`
  - New: returns multiple owner-owned trainings (already partially covered — extend to ≥3 rows and assert ordering by `updatedAt`).
  - New: surfaces a training id found only in an `rw_backup_*` localStorage envelope (mock `localStorage`).
  - New: malformed envelope (`JSON.parse` throws, missing fields, wrong types) is skipped without throwing.
  - Existing: other-user filtering, soft-delete skip, offline behavior — keep passing.
- `src/lib/__tests__/recovery-readonly-page.test.ts` — confirm still green after the edits (no new write tokens, no new disallowed imports). The `profiles` SELECT is read-only and the supabase client import is already allowed for the page.
- `src/lib/recovery/__tests__/self-service-restore.test.ts` — must remain unchanged and green.

### 4. Out of scope (explicitly not changed)

- `self_service_fill_missing_training_field` SQL function and its TS wrapper.
- Sync engine, savers, IDB schema/migrations, service worker, version policy, audit trigger, RLS, Playwright config, edge functions, production data.
- Inspections, daily assessments, photos, or any non-training report type.

## Acceptance check (manual, after merge)

1. Sign in, open Profile → Recovery & Sync Health.
2. List shows every training the user has on this device — including ones only present in a local backup envelope.
3. Each row shows camp, date, trainer (when known), local/server status, and a *Flagged for recovery* badge when applicable.
4. Search box filters by camp / trainer / date in real time.
5. *Check this report* works on any listed training; **Fill Missing Text** still appears only on eligible blank owner-owned fields; populated fields are not overwritten.
6. Offline: list still renders from IDB + local backup envelopes; server-only metadata simply absent.
