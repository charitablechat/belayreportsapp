

# Daily Backup Email — Full Archive Every Time

## Current State
- 10 HTML reports, ~26 MB total
- JSON backup ~1.6 MB compressed
- **Total: ~28 MB** — fits within Resend's 40 MB limit

## Plan

Modify `scheduled-backup-notify` to attach ALL HTML reports (not just deltas) plus the JSON backup. Add a safety valve: if total attachments exceed 35 MB, fall back to a download link instead.

### Changes to `supabase/functions/scheduled-backup-notify/index.ts`

1. **Fetch ALL reports with HTML** — query `inspections`, `trainings`, `daily_assessments` where `latest_report_html IS NOT NULL`
2. **Build individual `.html` attachments** — one per report, named `{type}/{Org}_{Date}_{id-prefix}.html`
3. **Build `backup.json.gz`** — same as current (all tables, HTML blobs stripped)
4. **Size check before sending**:
   - Calculate total attachment size
   - If ≤ 35 MB: attach everything directly to the email
   - If > 35 MB: upload a ZIP to `database-backups` bucket, attach only `backup.json.gz` to email, include a 7-day signed download link for the full archive
5. **Update email template stats** — show total reports attached, total size, and whether it's a full or partial attachment

### Email Structure (when it fits)
```
Attachments:
  backup.json.gz                              (~1.6 MB)
  reports/inspections/Acme_2026-03-15.html    (~3 MB)
  reports/trainings/Safety_2026-01-10.html    (~4 MB)
  ... all other reports ...
```

### Email Structure (when too large)
```
Attachments:
  backup.json.gz                              (~1.6 MB)

Body includes:
  "⚠️ Full archive too large for email (42 MB). Download here: [link]"
```

### Files Modified
1. **`supabase/functions/scheduled-backup-notify/index.ts`** — change delta logic to fetch ALL HTML reports; add 35 MB threshold check with fallback to storage + download link
2. **`supabase/functions/_shared/transactional-email-templates/backup-notification.tsx`** — add conditional messaging for "full attachment" vs "download link" scenarios

No database or client-side changes needed.

