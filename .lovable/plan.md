
# Plan: Fix Previous Inspection Date Validation for Special Values (v2.2.95)

## Problem Summary

The **'Last Known Inspection Date'** field set to 'Unknown' or 'N/A' is blocking report progression due to:

1. **Missing user feedback** - The `completeInspection` function silently returns when validation fails without showing any toast message
2. **Edge function date parsing** - The `formatDate` functions in report generation attempt to parse "N/A" and "Unknown" as dates, resulting in "Invalid Date"
3. **Client utility gap** - The `parseLocalDate` utility doesn't handle special values gracefully

## Root Cause Analysis

### Finding 1: Silent Validation Failure
In `InspectionForm.tsx` (lines 1377-1386), when validation fails:
```typescript
if (!validation.success) {
  const firstError = formatValidationError(validation.errors[0]); // Error formatted
  const totalErrors = validation.errors.length;
  // ... only console.error in DEV mode
  return;  // ← Silently returns without showing any toast!
}
```

### Finding 2: Edge Function Date Parsing
Both `generate-inspection-html` and `generate-inspection-pdf` use:
```typescript
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString(...); // ← "N/A" becomes "Invalid Date"
};
```

### Finding 3: Client Utility
`parseLocalDate` in `date-utils.ts`:
```typescript
export const parseLocalDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return undefined;
  const dateOnly = dateStr.split('T')[0];
  const [year, month, day] = dateOnly.split('-').map(Number); // "N/A" → [NaN]
  return new Date(year, month - 1, day); // Invalid Date
};
```

## Solution

### Fix 1: Add toast feedback for validation failures

Add a toast message when `completeInspection` validation fails so users understand why completion isn't proceeding.

```typescript
if (!validation.success) {
  const firstError = formatValidationError(validation.errors[0]);
  
  toast({
    title: "Cannot complete inspection",
    description: firstError,
    variant: "destructive",
  });
  
  if (import.meta.env.DEV) {
    console.error('[InspectionForm] Cannot complete - validation errors:', 
      validation.errors.map(formatValidationError));
  }
  return;
}
```

### Fix 2: Handle special values in edge function `formatDate`

Update both edge functions to recognize "N/A" and "Unknown" as special values:

```typescript
const SPECIAL_DATE_VALUES = ["N/A", "Unknown"];

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "N/A";
  // Pass through special values as-is
  if (SPECIAL_DATE_VALUES.includes(dateStr)) return dateStr;
  // Validate it's a parseable date
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr; // Return original if invalid
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};
```

### Fix 3: Handle special values in client `parseLocalDate`

Add guard for special values in the utility:

```typescript
const SPECIAL_DATE_VALUES = ["N/A", "Unknown"];

export const parseLocalDate = (dateStr: string | null | undefined): Date | undefined => {
  if (!dateStr) return undefined;
  // Don't try to parse special values
  if (SPECIAL_DATE_VALUES.includes(dateStr)) return undefined;
  
  const dateOnly = dateStr.split('T')[0];
  const [year, month, day] = dateOnly.split('-').map(Number);
  
  // Validate parsed components
  if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
  
  return new Date(year, month - 1, day);
};
```

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/InspectionForm.tsx` | Modify | Add toast for validation failure in `completeInspection` |
| `src/lib/date-utils.ts` | Modify | Handle special date values in `parseLocalDate` |
| `supabase/functions/generate-inspection-html/index.ts` | Modify | Handle special values in `formatDate` |
| `supabase/functions/generate-inspection-pdf/index.ts` | Modify | Handle special values in `formatDate` |
| `vite.config.ts` | Modify | Version bump to 2.2.95 |

## Implementation Details

### InspectionForm.tsx Changes (around line 1377)

```typescript
if (!validation.success) {
  const firstError = formatValidationError(validation.errors[0]);
  const totalErrors = validation.errors.length;
  
  // Show user feedback for validation failure
  toast({
    title: "Cannot complete inspection",
    description: totalErrors > 1 
      ? `${firstError} (+${totalErrors - 1} more issue${totalErrors > 2 ? 's' : ''})`
      : firstError,
    variant: "destructive",
  });
  
  if (import.meta.env.DEV) {
    console.error('[InspectionForm] Cannot complete - validation errors:', 
      validation.errors.map(formatValidationError));
  }
  return;
}
```

### date-utils.ts Changes

```typescript
// Special values that should not be parsed as dates
const SPECIAL_DATE_VALUES = ["N/A", "Unknown"];

export const parseLocalDate = (dateStr: string | null | undefined): Date | undefined => {
  if (!dateStr) return undefined;
  
  // Don't attempt to parse special marker values
  if (SPECIAL_DATE_VALUES.includes(dateStr)) return undefined;
  
  // Handle dates that might already include time component
  const dateOnly = dateStr.split('T')[0];
  const [year, month, day] = dateOnly.split('-').map(Number);
  
  // Validate parsed components are valid numbers
  if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
  
  return new Date(year, month - 1, day);
};
```

### Edge Function Changes

Both `generate-inspection-html/index.ts` and `generate-inspection-pdf/index.ts`:

```typescript
// Special date values that should be displayed as-is
const SPECIAL_DATE_VALUES = ["N/A", "Unknown"];

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "N/A";
  
  // Pass through special values without parsing
  if (SPECIAL_DATE_VALUES.includes(dateStr)) return dateStr;
  
  // Attempt to parse as date
  const date = new Date(dateStr);
  
  // If invalid date, return original string
  if (isNaN(date.getTime())) return dateStr;
  
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};
```

## Data Integrity

These changes:
- Do **NOT** modify the validation schema - "N/A" and "Unknown" remain valid string values
- Do **NOT** affect IndexedDB persistence - the values are stored and retrieved as-is
- Do **NOT** change database constraints - the column remains a text field
- **ONLY** improve display handling and user feedback

## Testing Checklist

1. Create new inspection → Set Previous Inspection Date to "N/A" → Click Complete → Verify completion succeeds
2. Create new inspection → Set Previous Inspection Date to "Unknown" → Click Complete → Verify completion succeeds
3. Create inspection with invalid required fields → Click Complete → Verify toast error message appears
4. Generate HTML report with "N/A" previous date → Verify "N/A" displays correctly (not "Invalid Date")
5. Generate PDF report with "Unknown" previous date → Verify "Unknown" displays correctly
6. Verify regular date selection still works correctly (calendar date parses and displays properly)
