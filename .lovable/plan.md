

## Attach Compressed Backup JSON to Daily Email via Resend

### What Changes

Modify `supabase/functions/scheduled-backup-notify/index.ts` to send the daily backup email through the Resend connector gateway with the backup JSON as a **gzip-compressed file attachment** (`.json.gz`), instead of sending a download link via the transactional email system.

### Why

- Make.com can parse an actual file attachment but cannot follow signed download links
- Gzip compression typically reduces JSON by 90%+ (~29 MB becomes ~2-3 MB), well within Resend's 40 MB limit and future-proof as the database grows

### Implementation

**File: `supabase/functions/scheduled-backup-notify/index.ts`**

1. After the backup JSON is built and uploaded to storage (existing steps 1-3 stay the same), **gzip compress** the JSON bytes using Deno's built-in `CompressionStream` API
2. **Base64-encode** the compressed bytes
3. **Replace** the `send-transactional-email` invocation (step 5) with a direct call to the Resend connector gateway:
   - URL: `https://connector-gateway.lovable.dev/resend/emails`
   - Headers: `Authorization: Bearer $LOVABLE_API_KEY`, `X-Connection-Api-Key: $RESEND_API_KEY_1`
   - Body includes `attachments` array with one entry: `{ filename: "ropeworks-backup-YYYY-MM-DD.json.gz", content: <base64 gzip data> }`
   - Simple HTML body with backup summary (timestamp, file size, row count, table counts)
   - From: `Ropeworks <noreply@notify.belayreports.com>`
   - To: `kale@belayreports.com`
4. The signed download URL generation (step 4) and storage upload remain as-is for redundancy

### Existing behavior preserved
- Backup JSON still uploaded to `database-backups` storage bucket
- `backup_history` record still created
- Email subject and summary info remain the same

### Technical Details
- Uses Deno's native `CompressionStream("gzip")` — no external dependencies
- The connector gateway handles Resend auth token refresh automatically
- Secrets used: `LOVABLE_API_KEY` (already exists), `RESEND_API_KEY_1` (just connected)
- Edge function will be redeployed after changes

