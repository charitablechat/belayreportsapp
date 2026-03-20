
Audit complete. The remaining wrapping issue is in the Inspection HTML mobile CSS path (not the form UI or upload widgets).

What I found
- Photo-upload/display components are responsive and not the root cause (`ItemPhotoUpload`, inspection table mobile cards).
- The Inspection HTML report still has a breakpoint gap:
  - Critical wrapping fixes for `.info-cell`, `.info-value`, table cell wrapping, and gallery safety are mostly in `@media (max-width: 600px)`.
  - At 601–768px, content falls back to less strict rules, so long strings and table content can still overflow.
- Inspection table column sizing still carries desktop constraints (fixed widths + `min-width`) into mobile contexts, which hurts wrapping.
- Viewer-injected CSS in `HtmlReportViewer.tsx` is capped at 600px and targets `.info-item` (training/daily), but Inspection uses `.info-cell`, so some fixes never apply there.

Implementation plan
1) `supabase/functions/generate-inspection-html/index.ts` (primary fix)
- Consolidate “must-wrap” mobile rules into the 768 breakpoint (not only 600):
  - `.info-cell { display:block }`
  - `.info-label/.info-value` explicit wrapping (`word-break`, `overflow-wrap`)
  - `th, td` wrapping safeguards
  - `.photo-gallery` full-width behavior and image containment
- Add mobile overrides to neutralize desktop column constraints on small screens:
  - Reset table cell `min-width`/width constraints for mobile with targeted selectors.
  - Keep thumbnail scaling and readable font-size tiers (768 + 480).
- Add wrapping guards for list content injected into cells:
  - `.comment-bullets`, `.summary-list`, and their `li` children (`overflow-wrap:anywhere`, `word-break:break-word`).

2) `src/components/HtmlReportViewer.tsx` (secondary safety net)
- Expand injected media query from 600px to 768px so tablet/large-phone widths get the same fixes.
- Add Inspection-specific selectors currently missing:
  - `.info-cell`, `.info-value`, `.comment-bullets`, `.summary-list`
- Keep report-agnostic grid collapse rules, but avoid conflicting overrides already handled by report CSS.

3) Cross-format guardrails
- Keep all changes scoped to screen/mobile media queries only.
- Do not alter print media blocks used for export behavior, so PDF output remains stable.

Validation checklist after implementation
- Generate Inspection HTML with intentionally long unbroken text in:
  - Facility fields, comments, and summary bullets.
- Verify at 390px, 430px, 768px widths:
  - No text clipping in header/info sections.
  - Table text wraps inside cells (no truncated words).
  - Photos remain contained and not distorted.
- Verify “Save PDF” from viewer still renders correctly (no regression in print layout).
