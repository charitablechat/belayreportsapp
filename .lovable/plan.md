# Remove "Edited After Completion" Banner from Reports

## Scope

The amber warning banner ("⚠ This report was edited after completion. Last modified by … on … (N edits total). Full audit trail available in the admin panel.") is rendered at the top of every generated report HTML/PDF when post-completion admin edits exist. It appears on **all three report types** via a single shared helper.

## What Changes

### 1. `supabase/functions/_shared/report-layout.ts`
- Make `buildAdminEditBanner()` return an empty string unconditionally (keep the function exported so the three callers don't need import changes / type churn).
- Leave `fetchPostCompletionEdits()` in place — it's harmless and its result is now just discarded by the banner. This minimizes diff and keeps the audit-trail data path available if you ever want to surface it elsewhere (admin panel only).

### 2. Three edge function call sites (no signature changes)
- `supabase/functions/generate-inspection-html/index.ts` (line 1664)
- `supabase/functions/generate-training-html/index.ts` (line 771)
- `supabase/functions/generate-daily-assessment-html/index.ts` (line 860)

Since `buildAdminEditBanner` will now always return `''`, the `${adminEditBannerHtml}` interpolations become no-ops automatically. **No edits needed at the call sites** — but I will also remove the now-pointless `fetchPostCompletionEdits` invocation in each to save a database round-trip per report render (small perf win, aligned with the recent I/O optimization work).

## What Stays Untouched

- `audit_logs` table and `record_admin_edit` triggers — the audit trail itself is preserved.
- `AuditLogPanel.tsx` admin UI — admins can still see the full edit history in the admin panel.
- Attestation block, completion lock, and any other report metadata.
- PDF generation pipeline — `generate-inspection-pdf` / `generate-training-pdf` consume the HTML output, so the banner disappears from PDFs automatically.
- Cached HTML reports already stored in `*_reports.html_content` — these will continue to show the banner until regenerated. Per the **Report Output Integrity** memory we bypass regeneration if the stored HTML is unchanged. **Recommendation:** force a one-time regeneration on next view by leaving cache as-is (users who reopen will get fresh HTML the next time the underlying record is touched). If you want a hard purge of cached HTML banners now, say so and I'll add a small migration that nulls `html_content` on completed reports — flagging this as a decision point rather than assuming.

## Risk

Very low. The change is additive-removal in one helper; no schema, RLS, sync, photo, or auth surface is touched. Edge function deploys are automatic.

## Files Modified

- `supabase/functions/_shared/report-layout.ts` (~5 line change)
- `supabase/functions/generate-inspection-html/index.ts` (remove fetch call + variable)
- `supabase/functions/generate-training-html/index.ts` (same)
- `supabase/functions/generate-daily-assessment-html/index.ts` (same)
