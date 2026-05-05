## Goal
Universal rule across all PDF reports: a major section header (h2) should never start midway through a page. If it would, it must move to the top of the next page. Specific symptom: ACCT Operations Standards header appearing low on the Equipment page.

## Changes

### 1. Inspection PDF (`supabase/functions/generate-inspection-html/index.ts`)
- Disable the equipment+standards page-combination so Standards always starts on its own page:
  - Force `canCombineEquipmentStandards = false` and emit Equipment + Standards as separate `<div class="page">` blocks (existing separate branch already exists).
  - Update `pageCount` math accordingly.
- Add a universal CSS rule applied to all section headers (`h2`, `.combined-section > h2`, `.page-content > h2`):
  ```css
  h2 { break-before: auto; page-break-after: avoid; break-after: avoid; }
  .section-divider + .combined-section { break-before: page; page-break-before: always; }
  ```
- For any future combined-section pattern, apply `page-break-before: always` to the second `.combined-section` so its header lands at the top of a new sheet.

### 2. Training PDF (`supabase/functions/generate-training-html/index.ts`)
Add the same universal h2 / section-break rule so any section header that would land mid-page is pushed to the next page.

### 3. Daily Assessment PDF (`supabase/functions/generate-daily-assessment-html/index.ts`)
Same universal rule.

## Universal mechanism
The CSS rule is applied to the shared `h2` selector inside `.page-content`. Combined with `page-break-after: avoid` on preceding elements where appropriate, this guarantees a section header starts on a fresh page if there isn't enough room for it (and a few lines of body) on the current page.

We keep prior tightened margins from the previous pass — only page-break behavior changes.

## Verification
After deploy, regenerate the Solid Rock Camps inspection report and confirm:
- Equipment ends on its page; ACCT Operations Standards starts at the top of the next page.
- No empty pages and no excessive white space elsewhere.
- Training and Daily Assessment reports still render normally.
