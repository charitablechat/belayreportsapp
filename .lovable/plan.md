# Disk Space Audit + Cleanup + Resize

I queried your database and storage buckets. Here is exactly where your 26.7 GB is going, what to clean up, and the order to do it in.

## What's actually consuming your disk

**Database tables (~22.6 GB):**

| Table | Size | Notes |
|---|---|---|
| `audit_logs` | **22 GB** | The whole problem. ~110k rows. |
| `trainings` | 132 MB | Normal. |
| `admin_edit_snapshots` | 91 MB | Normal. |
| `report_cloud_backups` | 19 MB | Normal. |
| Everything else | < 10 MB each | Normal. |

Inside `audit_logs`, **21 GB comes from just 4,899 rows of `trainings.update`** — every training update is storing the entire old + new row as JSON, and training rows are huge (cached HTML, summaries, etc.). Another 192 MB is `inspections.update` (96k rows) and 157 MB is `daily_assessments.update`.

**Storage buckets (~11.7 GB):**

| Bucket | Size | Notes |
|---|---|---|
| `database-backups` | **7.3 GB** | 7,746 daily backup files since April 2 (~33 days). No retention policy. |
| `inspection-photos` | 2.0 GB | Real user data. |
| `inspection-reports` (cached HTML) | 1.6 GB | Regenerable. |
| `training-photos` | 745 MB | Real user data. |
| Others | < 60 MB | Fine. |

**Bottom line:** ~28 GB of the ~29 GB you're using is `audit_logs` + old daily backups. Both are safely prunable.

## Plan

### Step 1 — Audit (already done above)

Findings shown in the table. No further action needed for this step; the numbers are the audit.

### Step 2 — Add retention / cleanup policies

**A. Trim `audit_logs` aggressively.**
- Strip the bulky `old_values` / `new_values` JSON from `*.update` rows older than 14 days, keeping the metadata (who/when/what action). This preserves the audit trail but drops the giant payloads.
- Hard-delete `client.error` rows older than 30 days.
- Hard-delete any `*.update` audit rows older than 90 days entirely.
- Expected reclaim: **~21 GB**.

**B. Stop `trainings.update` from logging full row snapshots going forward.**
The `fn_audit_table_change` trigger writes `to_jsonb(NEW)` for every update. For `trainings` (and `inspections`, `daily_assessments`), strip the heavy fields (`latest_report_html`, `summary`, `narrative`, etc.) before storing. Keeps the audit useful, prevents regrowth.

**C. Add a 14-day retention on `database-backups/daily/`.**
A scheduled cleanup (daily pg_cron job) deletes any object under `daily/` older than 14 days. Offsite mirror already keeps long-term copies. Leaves `pdfs/` (64 MB, persistent) untouched.
- Expected reclaim: **~5 GB now, prevents future regrowth**.

**D. (Optional) Prune cached report HTML for completed reports older than 6 months.**
HTML is regenerated on demand when a user opens the report. Reclaim: ~1 GB. Skipping unless you want it — small impact.

### Step 3 — Resize the disk

After Steps 2A–2C run, you should be at roughly **3–4 GB used out of 40 GB**. At that point a resize is optional, but I recommend bumping to **60 GB** as a safety buffer (you can only ever increase, never decrease) so future growth doesn't trigger this alert again.

That's done by you in the screen you're already on: **New disk size (GB) → 60 → Increase disk size**. I cannot click that button — only you can.

## Order of operations

1. I run a migration that:
   - Adds the audit-log pruning SQL (one-shot delete + null-out of old payloads).
   - Updates `fn_audit_table_change` to strip heavy fields before snapshotting.
   - Adds a pg_cron job that nightly: (a) prunes audit_logs older than 14d/90d, (b) deletes `database-backups/daily/` objects older than 14d.
2. You watch the disk usage drop in the same Advanced screen (give it a few minutes for vacuum to release space, possibly an hour).
3. You bump the disk to 60 GB for headroom.

## Technical details

- Audit log pruning uses `UPDATE audit_logs SET old_values=NULL, new_values=NULL WHERE action_type LIKE '%.update' AND created_at < NOW() - INTERVAL '14 days'` followed by targeted `DELETE`s. Run inside a transaction with `VACUUM (FULL, ANALYZE) audit_logs` after to actually return pages to the OS.
- Trigger change: edit `fn_audit_table_change` to compute `v_new := to_jsonb(NEW) - 'latest_report_html' - 'summary' - 'narrative' - 'cached_html' - 'report_html'` (and same for `v_old`). Same for inspections/daily_assessments.
- Backup retention: pg_cron job calls a SECURITY DEFINER function that uses `storage.objects` DELETE filtered on `bucket_id='database-backups' AND name LIKE 'daily/%' AND created_at < NOW() - INTERVAL '14 days'`. This removes both the storage rows and the underlying files (Supabase storage trigger handles the file deletion).
- Nothing in this plan touches: photos, real report data, soft-deleted records (already on a separate 60-day cleanup), or your offsite mirror.

## What this does NOT do

- Does not delete a single inspection, training, daily assessment, or photo.
- Does not affect anyone's ability to view, edit, or generate reports.
- Does not break the audit trail — actor, timestamp, table, record id, and action stay intact for everything; only old bulky JSON snapshots get dropped.

Approve and I'll implement Steps 2A–2C in one migration. Then you do Step 3 in the UI.
