
Goal: make training reports preserve bullet-point structure consistently when users generate HTML and then save/print to PDF, so the PDF matches the HTML output exactly.

What I found
- The shared formatter already has the key content fix: `parseTextToList()` in `supabase/functions/_shared/training-formatter.ts` now converts `</p>`, `</div>`, `</li>`, and `<br>` into newlines before stripping HTML. That should correctly split each entered line into a separate bullet item.
- The generated training HTML already renders `observationsList` and `recommendationsList` as `<ul><li>...</li></ul>` in `supabase/functions/generate-training-html/index.ts`.
- The direct PDF path (`supabase/functions/generate-training-pdf/index.ts`) does not use the HTML at all; it rebuilds the summary using jsPDF tables. So there are two separate rendering paths today.
- The user issue is specifically about “HTML then save as PDF,” which means the critical gap is likely in the HTML print styles, not only in the shared parsing logic.

Implementation plan
1. Audit and align the training HTML print CSS
- Update the training HTML generator so summary bullet lists use a dedicated class instead of only inline styles.
- Add print-safe list rules for the summary section in `generate-training-html/index.ts`, including:
  - explicit `display: block`
  - reliable left padding/margin
  - `list-style-type: disc`
  - `list-style-position: outside`
  - print-safe `li` spacing and wrapping
- Ensure no global `ul` / `li` styling overrides interfere with summary bullets during print-to-PDF.

2. Make summary bullets structurally consistent
- Apply dedicated classes to both observations and recommendations lists/items.
- Keep the same class names and hierarchy in HTML so browser print output is predictable and easier to maintain.
- Preserve fallback plain-text rendering only when no parsed bullet items exist.

3. Review parity between HTML and direct PDF generation
- Compare the training summary section in `generate-training-html` and `generate-training-pdf`.
- If needed, adjust the direct PDF bullet indentation/spacing so both outputs visually match more closely, even though they use different renderers.
- Keep shared content parsing in `_shared/training-formatter.ts` as the single source of truth for item splitting.

4. Verify the client HTML viewing/print flow
- Confirm the HTML viewer path in `src/pages/TrainingForm.tsx` and `src/components/HtmlReportViewer.tsx` does not inject mobile or iframe styles that suppress list markers in print.
- If needed, scope viewer-injected styles so they do not override report bullet formatting when printing from the iframe.

Technical details
- Files most likely to change:
  - `supabase/functions/generate-training-html/index.ts`
  - possibly `supabase/functions/generate-training-pdf/index.ts`
  - possibly `src/components/HtmlReportViewer.tsx`
- Root design principle:
  - shared formatter decides what the bullet items are
  - HTML generator defines semantic list markup
  - print CSS guarantees browser PDF output preserves those bullets
- Important existing risk:
  - `generate-training-html/index.ts` has global `ul { list-style: none; padding-left: 0; }` and global `li` styling. Inline styles currently re-enable bullets, but print rendering can be fragile. Dedicated classes with explicit print rules are the safest fix.

Expected outcome
- Every line entered in the training summary becomes its own bullet item in generated HTML.
- When that HTML is saved/printed to PDF, the bullet points remain separate and visually match the HTML report.
- The output remains stable for normal use, off-site backup, and stored report artifacts.
