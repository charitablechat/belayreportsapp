
## Change: Update Report Glassmorphism Background Color to #c2c2c2

**Goal**: Replace all neutral light-grey background colors in reports (inspection, training, daily assessment) with #c2c2c2 to create a more uniform, prominent "glass" effect. Keep semantic colors (status indicators, warnings, section headers) unchanged.

**Scope**: Three report generation edge functions
1. `supabase/functions/generate-inspection-html/index.ts`
2. `supabase/functions/generate-training-html/index.ts`
3. `supabase/functions/generate-daily-assessment-html/index.ts`

**Color Replacements** (glassmorphism effect only):
- `#e5e7eb` → `#c2c2c2` (table headers, section backgrounds)
- `#f8f9fa` → `#c2c2c2` (info items, text content boxes)
- `#f8fafc` → `#c2c2c2` (content sections)
- `#f9fafb` → `#c2c2c2` (alternate backgrounds)
- `#f9f9f9` → `#c2c2c2` (table alternating rows)
- `#f1f5f9` → `#c2c2c2` (unchecked items)
- `#f5f5f5` → `#c2c2c2` (block quote backgrounds)
- `#f3f4f6` → `#c2c2c2` (section headers)

**Colors to Preserve** (semantic/status indicators):
- All status/result colors: `#fef3c7` (warning), `#f0f9ff` (pass), `#fff7ed` (provisions), `#fef2f2` (fail)
- Section title backgrounds: `#1e40af` (primary blue), `#dc2626` (red for critical)
- Result cell highlights: red, yellow, green for pass/fail/provisions
- Table result highlighting: `#fee2e2`, `#fef3c7`, `#dcfce7`

**Implementation**: Find-and-replace in each of the three functions, targeting CSS background properties within the embedded `<style>` tags and inline styles.

**No Functional Changes**: Purely cosmetic—no business logic, data structures, or report content modifications.
