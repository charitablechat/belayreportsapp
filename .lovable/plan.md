

## Include facility name in exported JSON filenames

### Problem
All JSON backup exports use generic filenames like `backup_inspection_abc12345_1710000000.json`. The user wants the facility/organization name included.

### Changes

**`src/lib/local-backup-ledger.ts`** — `downloadReportBackup()`
- Extract `snapshot.parent?.organization` and sanitize it (replace non-alphanumeric chars with underscores, trim)
- Change filename from `backup_${reportType}_${reportId.substring(0,8)}_${Date.now()}.json` to `backup_${reportType}_${sanitizedOrg}_${reportId.substring(0,8)}_${Date.now()}.json`

**`src/components/admin/DataRecoveryTool.tsx`** — 4 download locations:
1. **Single snapshot export** (line ~184): Include organization from snapshot data
2. **Bulk local backups** (line ~278): Include "all" or keep as-is (bulk export)
3. **Bulk cloud backups** (line ~515): Same as above
4. **Individual cloud backup** (line ~693): Include organization from the backup record
5. **Admin edit snapshot** (line ~866): Include organization if available

For all single-report downloads, extract the organization from the snapshot/record data and include it in the filename. Bulk exports that contain multiple facilities will keep their current generic naming.

### Sanitization helper
A small `sanitizeFilename(name: string)` utility that strips/replaces special characters to produce filesystem-safe names (e.g., `"Camp ABC & Co."` → `Camp_ABC_Co`).

