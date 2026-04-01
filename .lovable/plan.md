

## Add Excel & CSV Export Options to Backup Panel

**What you get**: Two new download buttons alongside the existing JSON download — one for Excel (.xlsx with each table as a sheet) and one for CSV (.zip with one file per table). Both convert the existing JSON backup on the client side.

---

### 1. New utility: `src/lib/backup-export.ts`

Client-side conversion functions that take the downloaded JSON backup blob and convert it:

- **`downloadBackupAsExcel(blob)`** — Uses the `xlsx` library (SheetJS) to create a workbook with one sheet per table, then triggers download as `.xlsx`
- **`downloadBackupAsCsv(blob)`** — Uses `xlsx` to create individual CSV strings per table, bundles them into a ZIP using `jszip`, triggers download as `.zip`

Dependencies to install: `xlsx`, `jszip`

---

### 2. Update `src/lib/full-backup.ts`

Add a new `downloadBackupFileRaw(filePath)` function that returns the raw `Blob` instead of immediately saving to device. The existing `downloadBackupFile` stays unchanged. The Excel/CSV converters will use this raw blob.

---

### 3. Update `DatabaseBackupsPanel.tsx`

Add a dropdown or two additional icon buttons per backup row:
- **Download JSON** (existing behavior)
- **Download Excel** — calls `downloadBackupFileRaw` → `downloadBackupAsExcel`
- **Download CSV** — calls `downloadBackupFileRaw` → `downloadBackupAsCsv`

Uses a small dropdown menu on the existing download button to keep the UI clean.

---

### Summary

| Change | File |
|--------|------|
| New file | `src/lib/backup-export.ts` — Excel & CSV conversion |
| Edit | `src/lib/full-backup.ts` — add raw blob download |
| Edit | `src/components/admin/DatabaseBackupsPanel.tsx` — download format dropdown |
| Install | `xlsx`, `jszip` packages |

