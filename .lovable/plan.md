

## Fix: Add Organization to Daily Assessment Header and Report Output

### Problem
The Organization field is captured when creating a new Daily Assessment (in `NewDailyAssessment.tsx`), but it is never displayed in the form's header component or included in the generated HTML/PDF report. The data exists in the database -- it is simply not rendered anywhere after creation.

### Root Cause
Two rendering gaps:
1. **Form Header** (`DailyAssessmentHeader.tsx`): Shows Date, Site, and Trainer -- but omits Organization entirely. Users cannot see or edit the organization after the report is created.
2. **HTML Report Template** (`generate-daily-assessment-html/index.ts`): The "Assessment Information" section renders Date, Site, and Trainer -- but never references `assessment.organization`.

### Fix (3 changes, no database changes needed)

**1. Add Organization field to `DailyAssessmentHeader.tsx`**
- Add an Organization row in the header grid, between Site and Trainer
- Use `OrganizationAutocomplete` (same as Site field) so it is editable and consistent with the rest of the app
- Displays as read-only when the report is locked or viewed by a non-owner

**2. Add Organization to the HTML report template (`generate-daily-assessment-html/index.ts`)**
- Insert a new `info-item` in the Assessment Information grid showing the Organization value
- Placed alongside Date and Site for a clean 2-column layout:
  - Row 1: Date | Site
  - Row 2: Organization | Trainer/Facilitator of Record

**3. No database or migration changes**
- The `organization` column already exists on `daily_assessments` and is populated at creation time
- The edge function already fetches `SELECT *` from the table, so `assessment.organization` is already available in the template context

### What the report will look like after the fix

```text
Assessment Information
+---------------------+--------------------------------+
| Date                | Site                           |
| February 23, 2026   | Marble Falls, Texas            |
+---------------------+--------------------------------+
| Organization        | Trainer/Facilitator of Record  |
| Acme Adventures     | Taylor Maanao                  |
+---------------------+--------------------------------+
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/daily-assessment/DailyAssessmentHeader.tsx` | Add Organization field (editable via OrganizationAutocomplete) |
| `supabase/functions/generate-daily-assessment-html/index.ts` | Add Organization info-item to the Assessment Information grid |

