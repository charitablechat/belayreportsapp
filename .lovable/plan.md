
What I verified
- `src/lib/report-naming.ts` is already correct: `formatReportFilename()` returns `Organization_MM_YYYY.ext`, and `sanitizeForFilename()` already replaces spaces with underscores.
- Both `src/components/HtmlReportViewer.tsx` and `src/lib/html-report-viewer.ts` already try to inject the filename into the report HTML `<title>`.

Root cause
- The filename helper is not the problem. The real issue is that the browser is not consistently using the injected report HTML `<title>` when naming the PDF.
- Right now the app only updates the inner report/new-window title. Some browsers/platforms use the top-level app document title instead, which explains why the save dialog still shows `Rope Works - Digital Inspection Platform.pdf`.
- The forms also calculate filename variables during report generation but do not preserve that report-specific filename/context; the viewer re-derives it later in JSX.
- Training’s direct PDF download uses a signed URL plus `a.download`, which browsers may ignore for cross-origin URLs.
- Report HTML fallbacks are inconsistent: inspection/training use generic titles, and daily assessment uses `site` instead of `organization`.

Implementation plan
1. Create one shared helper for report PDF naming/title injection
   - Reuse `formatReportFilename()` for the canonical download name
   - Add a small shared helper to derive the PDF title/base name and inject/replace `<title>` safely

2. Fix the viewer path in `src/components/HtmlReportViewer.tsx`
   - Stop relying only on the iframe/new-window HTML title
   - Temporarily set the top-level `document.title` to the PDF title while the viewer is open, then restore it on close
   - Use the same computed PDF title for the iframe, injected HTML, and Save PDF action

3. Harden `src/lib/html-report-viewer.ts`
   - Explicitly set `printWindow.document.title = pdfTitle`
   - Write HTML with the same injected `<title>`
   - Trigger print only after the print window has fully loaded

4. Pass stable report context from each form
   - Update `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx` to pass a dedicated report filename/context into the viewer instead of recalculating inline only at render time
   - Remove the currently unused local filename/title variables

5. Fix direct PDF downloads so the filename is enforced
   - Training: fetch the signed PDF URL as a Blob, then download via an object URL with `formatReportFilename(..., 'pdf')`
   - Inspection: align the client with the actual PDF function response shape and keep the final downloaded filename standardized

6. Normalize report HTML fallback titles
   - Update:
     - `supabase/functions/generate-inspection-html/index.ts`
     - `supabase/functions/generate-training-html/index.ts`
     - `supabase/functions/generate-daily-assessment-html/index.ts`
   - Make fallback titles organization-based so non-viewer/browser print flows are more consistent
   - For daily assessments, switch from `assessment.site` to `assessment.organization`

7. Keep storage keys unique
   - Do not force the backend storage object names to the standardized download name
   - Only the user-facing saved/downloaded filename should be `[Organization]_[MM]_[YYYY].pdf`

Validation after implementation
- Confirm `formatReportFilename('Acme Corp', ..., 'pdf')` returns `Acme_Corp_04_2026.pdf`
- Test Save PDF from the in-app viewer for:
  - Inspection
  - Training
  - Daily Assessment
- Test direct PDF download flows for inspection/training
- Verify the suggested filename no longer falls back to the app title
- Check desktop-width and mobile-width flows, plus cached report HTML paths

Expected result
- All user-saved PDFs will consistently default to `[Organization]_[Current Month]_[Current Year].pdf` across report types and platforms, instead of using the app title or inconsistent storage filenames.
