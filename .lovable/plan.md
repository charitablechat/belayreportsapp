

# Remove Email Button from All Reports

## Problem
The Email button and dialog in the report viewer are not needed and should be removed.

## Changes

### File: `src/components/HtmlReportViewer.tsx`

1. **Remove import** of `EmailReportDialog` (line 12) and `Mail` icon from lucide-react
2. **Remove state** `emailDialogOpen` (line 45)
3. **Remove `canEmail`** variable (line 48)
4. **Remove `handleEmail`** function (lines 232-234)
5. **Remove the Email button** (lines 257-268) — the disabled "coming soon" button
6. **Remove the `EmailReportDialog` render** (lines 330-342)
7. **Remove email-related props** from the interface (`reportType`, `organization`, `date`) — only if no other feature uses them. Since `reportType` is also used by the Share Link feature (line 244), keep it. Remove only email-specific logic.

### File: `src/components/EmailReportDialog.tsx`
- Delete the entire file (no longer referenced anywhere).

### File: `supabase/functions/send-report-email/index.ts`
- Keep for now (edge function deletion is a separate concern and it's harmless).

Two file edits, one file deletion. No structural changes.

