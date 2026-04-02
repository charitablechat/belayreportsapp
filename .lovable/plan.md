

# Comprehensive Audit: `scheduled-backup-notify` and Backup System

## Critical Findings

### F1: No Gzip Compression or Base64 Encoding (Missing Feature)
**Severity:** High — the user's request specifically asks to verify gzip compression, but it does not exist.

`scheduled-backup-notify/index.ts` has **zero** usage of `CompressionStream('gzip')` or base64 encoding. The backup data is uploaded as raw JSON to storage, and the email contains only an HTML body with a signed download URL — no compressed attachment is sent.

Per the memory note (`features/data-recovery/system-management-v5`), backups should be "sent as Gzip-compressed (.json.gz) attachments via the Resend connector gateway." This is not implemented.

**Fix:** After uploading all table JSON files to storage, reassemble a combined JSON payload, pipe it through `new CompressionStream('gzip')`, convert the resulting bytes to base64, and attach it to the Resend email as:
```typescript
attachments: [{
  filename: `ropeworks-backup-${timestamp}.json.gz`,
  content: base64GzipString,  // base64-encoded gzip bytes
}]
```

This requires:
1. A helper to gzip via `CompressionStream` (available in Deno)
2. A helper to convert `Uint8Array` to base64
3. Adding the `attachments` field to the Resend API call

**Memory concern:** The combined backup (~1.6 MB after HTML stripping, per memory) should compress to ~200-400 KB, well within Resend's 40 MB attachment limit and Deno's memory budget.

---

### F2: Missing Tables in `scheduled-backup-notify` vs `export-full-backup`
**Severity:** Medium — daily automated backups silently skip two tables.

`export-full-backup` includes `training_systems` and `training_equipment`. The `scheduled-backup-notify` TABLES array is **missing both**. This means daily automated backups lose training equipment/system data that manual backups capture.

**Fix:** Add `"training_systems"` and `"training_equipment"` to the TABLES array in `scheduled-backup-notify/index.ts` (after `"trainings"`, matching the order in `export-full-backup`).

---

### F3: Dead Code — `getSelectColumns()` Function
**Severity:** Low — no functional impact, but confusing.

The `getSelectColumns()` function (lines 132-139) always returns `"*"` and is never called. Column exclusion is handled by `stripColumns()` after fetching. This is dead code.

**Fix:** Remove the `getSelectColumns()` function.

---

### F4: Resend Gateway Integration — Correct but Incomplete
**Severity:** Low (gateway usage is correct; attachment is missing per F1).

The Resend call at line 267 is correctly structured:
- Endpoint: `https://connector-gateway.lovable.dev/resend/emails` ✅
- `Authorization: Bearer ${LOVABLE_API_KEY}` ✅
- `X-Connection-Api-Key: ${RESEND_API_KEY}` (from `RESEND_API_KEY_1`) ✅
- `from` uses verified domain `notify.belayreports.com` ✅

No issues with the gateway integration itself — the gap is only the missing attachment (F1).

---

### F5: Storage Upload Errors Are Logged but Not Fatal
**Severity:** Low — intentional resilience, but worth noting.

If a table's upload to `database-backups` fails (line 196-198), execution continues. The backup_history record and email are still sent, potentially reporting a backup that is partially incomplete. The manifest `table_counts` would show the correct row counts, but the storage files may be missing.

**Recommendation:** Track upload failures in the manifest and include a warning in the email if any uploads failed.

---

### F6: Manifest Upload Error Not Handled
**Severity:** Low — if the manifest upload fails (line 216-221), the error is silently ignored (no `error` destructuring or check). The backup_history insert and email proceed regardless.

**Fix:** Add error handling for the manifest upload, at minimum logging a warning.

---

### F7: `backup_history` Insert Error Not Handled
**Severity:** Low — line 224-229 has no error check. If the insert fails, there's no log.

**Fix:** Add `.then`/destructure error and log a warning (matching the pattern in `export-full-backup`).

---

## Security Findings

All secrets (`LOVABLE_API_KEY`, `RESEND_API_KEY_1`, `SUPABASE_SERVICE_ROLE_KEY`) are read from `Deno.env.get()` server-side only — none are exposed in frontend code. The function has `verify_jwt = false` (correct for pg_cron triggers). No security vulnerabilities found.

---

## Summary Table

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| F1 | No gzip compression or base64 attachment | High | Implement `CompressionStream` gzip, base64 encode, add Resend attachment |
| F2 | Missing `training_systems` and `training_equipment` tables | Medium | Add both tables to TABLES array |
| F3 | Dead `getSelectColumns()` function | Low | Remove |
| F4 | Resend gateway integration correct | — | No change |
| F5 | Partial upload failures not surfaced | Low | Track failures in manifest/email |
| F6 | Manifest upload error not handled | Low | Add error logging |
| F7 | backup_history insert error not handled | Low | Add error logging |

## Implementation Plan

### Step 1: Add missing tables (F2)
Add `"training_systems"` and `"training_equipment"` after `"trainings"` in the TABLES array.

### Step 2: Implement gzip compression + base64 attachment (F1)
Add two helper functions:
- `gzipCompress(data: Uint8Array): Promise<Uint8Array>` using `CompressionStream('gzip')`
- `uint8ToBase64(bytes: Uint8Array): string` using Deno's `btoa` or `encodeBase64`

After all tables are uploaded, build the combined backup JSON (reusing `tableCounts` and stripping excluded columns), compress it, base64-encode it, and add it to the Resend email payload as an attachment.

### Step 3: Clean up dead code and add error handling (F3, F5, F6, F7)
- Remove `getSelectColumns()`
- Add error destructuring and `console.warn` for manifest upload and backup_history insert
- Track failed table uploads in a `failedTables` array and include count in email subject/body if > 0

### Step 4: Redeploy
Deploy the updated `scheduled-backup-notify` edge function.

