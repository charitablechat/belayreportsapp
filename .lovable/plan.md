
# Plan: Fix Previous Inspection Date Column Type for Special Values (v2.2.96)

## Problem Summary

The **Create Inspection** button fails silently when the Previous Inspection Date field is set to "N/A" or "Unknown" because:

**Database error confirmed:**
```
invalid input syntax for type date: "N/A"
```

The `previous_inspection_date` column in the `inspections` table has data type `date`, but the UI allows users to select special string values ("N/A", "Unknown") which PostgreSQL cannot store in a date column.

## Root Cause

| Component | Current Behavior | Problem |
|-----------|------------------|---------|
| Database | `previous_inspection_date` is type `date` | Cannot store string values |
| UI (PreviousInspectionDatePicker) | Allows "N/A", "Unknown", or date selection | Outputs strings for special values |
| NewInspection.tsx | Passes value directly to database | No conversion of special values |
| Error handling | Catches error, logs to console | No toast shown to user |

## Solution

### Two-Part Fix:

1. **Database Migration**: Change `previous_inspection_date` column from `date` to `text` type to allow storing special string values
2. **Code Update**: Add error toast in NewInspection.tsx for visibility + loading spinner for feedback

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| Database Migration | Create | ALTER column from `date` to `text` |
| `src/pages/NewInspection.tsx` | Modify | Add error toast + loading spinner + double-submit guard |
| `vite.config.ts` | Modify | Version bump to 2.2.96 |

## Implementation Details

### 1. Database Migration

```sql
-- Change previous_inspection_date from date to text to support special values
ALTER TABLE public.inspections 
  ALTER COLUMN previous_inspection_date TYPE text 
  USING previous_inspection_date::text;

-- Add comment for documentation
COMMENT ON COLUMN public.inspections.previous_inspection_date IS 
  'Stores either a date string (YYYY-MM-DD), "N/A" (never inspected), or "Unknown" (date not recorded)';
```

### 2. NewInspection.tsx Changes

**Add useRef import:**
```typescript
import { useState, useEffect, useRef } from "react";
```

**Add double-submit guard:**
```typescript
const isSubmitting = useRef(false);
```

**Update handleSubmit with error toast and guard:**
```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  
  // Prevent double submission
  if (isSubmitting.current || loading) {
    return;
  }
  
  isSubmitting.current = true;
  triggerHaptic('medium');
  setLoading(true);

  try {
    // ... existing logic unchanged ...
    
    triggerHaptic('success');
  } catch (error: any) {
    console.error("Error creating inspection:", error);
    triggerHaptic('error');
    
    // Show error toast to user
    toast.error("Failed to create inspection", {
      description: error.message || "Please try again"
    });
  } finally {
    setLoading(false);
    isSubmitting.current = false;
  }
};
```

**Update submit button with loading spinner:**
```typescript
<Button type="submit" disabled={loading} className="flex-1">
  {loading ? (
    <>
      <Loader2 className="w-4 h-4 animate-spin mr-2" />
      Creating...
    </>
  ) : (
    isOnline ? "Create Inspection" : "Create Locally"
  )}
</Button>
```

Note: `Loader2` is already imported in the file (line 10).

## Data Integrity

- **Existing date values**: The migration uses `::text` cast which converts existing dates to ISO format strings (e.g., "2025-12-25") - fully compatible
- **No data loss**: All existing inspection records remain intact
- **Backwards compatible**: Edge functions already handle "N/A"/"Unknown" display (fixed in v2.2.95)
- **Validation**: The Zod schema already accepts strings for this field

## Testing Checklist

1. **Create inspection with "N/A"** - Should succeed and navigate to form
2. **Create inspection with "Unknown"** - Should succeed and navigate to form  
3. **Create inspection with calendar date** - Should succeed (regression test)
4. **Create inspection with no date selected** - Should succeed (null value)
5. **Verify loading spinner** - Button should show spinner during creation
6. **Verify error feedback** - If network error occurs, toast should appear
7. **Generate report with special date** - "N/A" or "Unknown" should display correctly
