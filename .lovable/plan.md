

## Fix JSON Import for Legacy Backup Files

### Problem
The `importReportBackup()` function requires `reportType` and `reportId` at the top level of the JSON. Older exported files (and raw snapshots from the DataRecoveryTool's various "Download JSON" buttons) may not have these wrapper fields — they might be raw `ReportSnapshot` objects with only `{ v, ts, synced, device, parent, children }`. The error "Missing or invalid reportType" fires for these files.

### Solution
Add **auto-inference** logic to `importReportBackup()` in `src/lib/local-backup-ledger.ts`:

1. If `parsed.reportType` is missing, check if this is a raw snapshot (has `parent` and `children` directly):
   - Infer `reportType` from the parent data structure:
     - Has `inspection_date` or `inspector_id` → `inspection`
     - Has `training_date` or `trainer_name` → `training`
     - Has `assessment_date` or `site_name` → `daily_assessment`
   - Extract `reportId` from `parent.id`
   - Use the parsed object itself as the snapshot

2. If none of the above matches, try one more level: check if the file is a bulk export array or other legacy format and provide a clearer error message.

3. Also handle the case where the file has `report_type` (snake_case from cloud/admin exports) instead of `reportType` (camelCase).

### File Changed
- **`src/lib/local-backup-ledger.ts`** — Update `importReportBackup()` to add fallback inference before the validation check, making it retroactively compatible with all previously exported files.

