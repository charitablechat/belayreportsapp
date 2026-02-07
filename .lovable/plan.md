

# Plan: Skip Validation on Report Completion - v2.4.9

## What Changes

Remove the validation gate that blocks report completion. When you click "Complete", the report will always be marked as completed regardless of any validation issues.

Validation warnings will still be logged to the console in development mode for debugging, but they will **never** prevent completion.

## Technical Details

### File: `src/pages/InspectionForm.tsx`

**Modify `completeInspection` function** (lines 1414-1501):

Remove the early `return` on validation failure. Instead, log warnings (dev only) and proceed directly to saving and completing.

Before:
```
if (!validation.success) {
  toast({ title: "Cannot complete inspection", ... });
  return;  // <-- blocks completion
}
```

After:
```
if (!validation.success && import.meta.env.DEV) {
  console.warn('[InspectionForm] Completing with validation warnings:',
    validation.errors.map(formatValidationError));
}
// No return - always proceed to completion
```

### File: `vite.config.ts`

Bump version to **v2.4.9**.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Remove validation block in `completeInspection` -- always proceed |
| `vite.config.ts` | Version bump to v2.4.9 |

## What Stays the Same

- Save logic, offline handling, confetti, and haptics are untouched
- PDF/HTML generation guards remain (they check `status === 'completed'`)
- The validation schemas themselves remain for any future use
- No sync, auth, or database changes

