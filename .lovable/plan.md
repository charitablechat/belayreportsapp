

# Report Deletion Investigation — Findings and Fixes

## Current State

Report deletion **does work** for authenticated owners while online. The flow is:
1. User clicks Delete on a report card → confirmation dialog opens
2. On confirm, Dashboard calls `supabase.from(table).update({ deleted_at, deleted_by, retention_until })` with `.eq('id', reportId)`
3. RLS UPDATE policies for all three tables allow owners to update their own records (no `deleted_at IS NULL` restriction in the USING clause)

**No RLS blocker exists.** Owners can soft-delete their own inspections, trainings, and daily assessments.

## Issues Found

### 1. Training deletion fails offline (inconsistency)
**Severity: Medium**

Inspections and daily assessments show a success message when deleted offline. Trainings show an **error toast** ("Cannot delete training while offline") and abort. This is confusing and inconsistent.

**Fix:** Handle offline training deletion the same way as daily assessments — remove from local storage and show a "will be deleted when online" message.

### 2. Misleading "cannot be undone" dialog text
**Severity: Low**

The delete confirmation says *"This action cannot be undone"* — but soft-delete **is** recoverable within 60 days by an admin. The message should reflect this.

**Fix:** Change to *"This report will be moved to trash and permanently deleted after 60 days."*

### 3. Daily assessment offline deletion doesn't actually queue the operation
**Severity: Medium**

For inspections, the offline path calls `queueOperation('update', ...)` to sync the soft-delete later. For daily assessments, it just shows a success toast **without** queueing. The report is removed from IndexedDB but the server record remains active — it will reappear on next sync.

**Fix:** Add `queueOperation` call for daily assessments (same pattern as inspections).

### 4. No ownership guard on the delete button
**Severity: Low**

The delete button in `ReportCard` is always visible. If an admin is viewing someone else's report, they can trigger deletion. The soft-delete sets `deleted_by` to the admin's ID, so it's auditable, but there's no visual distinction or confirmation that you're deleting someone else's report.

**Fix:** Optional — add a warning in the confirmation dialog when `inspector_id !== currentUserId`.

## Compatibility with Backup Pipeline

The backup pipeline (`generate-backup-pdfs`, `sync-offsite-backup`) already filters for `deleted_at IS NULL` when querying reports. Soft-deleted reports are excluded from future backups. Previously generated PDFs/HTMLs in the persistent `pdfs/` folder remain in storage (they are not cleaned up when a report is soft-deleted) — this is correct behavior for archival purposes.

No changes needed for backup compatibility.

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Fix offline training deletion (queue instead of error); fix offline daily assessment deletion (add queueOperation); update dialog text to reflect 60-day retention |

