

## Fix: Next Inspection Date Off by One Day in Reports

### Root Cause

The `formatDate` function in the backend edge functions parses date-only strings (like `"2027-02-06"`) using `new Date(dateStr)`. JavaScript interprets `"YYYY-MM-DD"` as **midnight UTC**. The function then formats with `timeZone: "America/Chicago"` (UTC-6), which shifts `2027-02-06T00:00:00Z` back to `2027-02-05T18:00:00 CST` -- rendering as **February 5, 2027** instead of the correct **February 6, 2027**.

This affects three edge functions:

| File | Issue |
|------|-------|
| `supabase/functions/generate-inspection-html/index.ts` | `formatDate` uses `new Date(dateStr)` with `timeZone: "America/Chicago"` |
| `supabase/functions/generate-inspection-pdf/index.ts` | `formatDate` uses `new Date(dateStr)` (no timezone specified, but still parses as UTC) |
| `supabase/functions/generate-daily-assessment-html/index.ts` | Same `formatDate` pattern with `timeZone: "America/Chicago"` |

The frontend input and storage are correct -- `SummarySection.tsx` uses `parseLocalDate` and `format(date, "yyyy-MM-dd")` properly, storing `"2027-02-06"` in the database. The bug is solely in the backend rendering.

### Fix

Replace `new Date(dateStr)` in all three `formatDate` functions with manual component parsing that creates a local date, preventing UTC interpretation from shifting the day.

The updated `formatDate` will parse `"YYYY-MM-DD"` strings by splitting on `-` and constructing the date from components, just like the frontend's `parseLocalDate` already does:

```typescript
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "N/A";
  const SPECIAL_DATE_VALUES = ["N/A", "Unknown"];
  if (SPECIAL_DATE_VALUES.includes(dateStr)) return dateStr;

  // Parse date-only strings (YYYY-MM-DD) as local to avoid UTC shift
  const dateOnly = dateStr.split('T')[0];
  const parts = dateOnly.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts.map(Number);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      // Format manually to avoid any timezone conversion
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      return `${months[month - 1]} ${day}, ${year}`;
    }
  }

  // Fallback for datetime strings or unparseable values
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};
```

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` (line ~333) | Replace `formatDate` with timezone-safe version |
| `supabase/functions/generate-inspection-pdf/index.ts` (line ~88) | Replace `formatDate` with timezone-safe version |
| `supabase/functions/generate-daily-assessment-html/index.ts` (line ~103) | Replace `formatDate` with timezone-safe version |

### What This Fixes

- **Next Inspection Date**: "2027-02-06" will render as "February 6, 2027" (not Feb 5)
- **Inspection Date**: Same fix applies to `inspection_date`
- **Previous Inspection Date**: Same fix applies
- **Daily Assessment Date**: Same fix applies
- Any other date-only field passed through `formatDate`

### What is NOT Changing

- No frontend changes needed (input and storage are already correct)
- No database schema changes
- No changes to training HTML generation (it doesn't use this pattern)
- The fallback for datetime strings with time components still uses `toLocaleDateString` with timezone for accurate rendering

