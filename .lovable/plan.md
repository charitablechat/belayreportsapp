

# Robust Calendar Dropdown Navigation

## Problem

The `Calendar` component uses `captionLayout="dropdown-buttons"` from react-day-picker v8, which renders separate Month and Year dropdowns. When a user changes one dropdown (e.g., Month to "February"), then changes the other (e.g., Year to "2023"), the uncontrolled internal state can behave unpredictably — the month may reset, or the calendar view may not reflect both selections together. This affects all 6 calendar instances across the app.

## Root Cause

The `Calendar` component passes no `month` or `onMonthChange` props to `DayPicker`. It runs fully uncontrolled. React-day-picker v8's dropdown mode manages its own displayed month state, which can produce inconsistent results when month and year dropdowns are changed in sequence — particularly when the selected day doesn't exist in the new month/year combination.

## Affected Components (6 Calendar instances)

1. `InspectionHeader.tsx` — Inspection Date
2. `PreviousInspectionDatePicker.tsx` — Previous Inspection Date
3. `TrainingHeader.tsx` — Start Date
4. `TrainingHeader.tsx` — End Date
5. `DailyAssessmentHeader.tsx` — Assessment Date
6. `DataRecoveryTool.tsx` — any date filtering (if present)

## Solution

**Single change in `src/components/ui/calendar.tsx`**: Add internal controlled state for the displayed month. This makes every Calendar instance automatically robust without touching any consumer code.

### Implementation

Add `month` and `onMonthChange` as controlled state inside the Calendar component, defaulting to the `selected` date (if provided) or `defaultMonth` or `new Date()`. This ensures both dropdowns compose correctly:

```typescript
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  // Controlled month state for robust dropdown navigation
  const [displayMonth, setDisplayMonth] = React.useState<Date>(
    () => (props as any).selected instanceof Date 
      ? (props as any).selected 
      : (props as any).defaultMonth ?? new Date()
  );

  // Sync when selected date changes externally
  React.useEffect(() => {
    if ((props as any).selected instanceof Date) {
      setDisplayMonth((props as any).selected);
    }
  }, [(props as any).selected]);

  const handleMonthChange = React.useCallback((date: Date) => {
    setDisplayMonth(date);
    (props as any).onMonthChange?.(date);
  }, [(props as any).onMonthChange]);

  return (
    <DayPicker
      month={displayMonth}
      onMonthChange={handleMonthChange}
      // ... rest unchanged
    />
  );
}
```

### What This Fixes

- **Month-first then Year**: The month selection is preserved in `displayMonth` state. When the year dropdown changes, `onMonthChange` fires with the composed date (correct month + new year), and `setDisplayMonth` captures it.
- **Year-first then Month**: Same mechanism in reverse.
- **No consumer changes needed**: All 6 calendar instances inherit the fix automatically.

## Files Changed

- `src/components/ui/calendar.tsx` — Add controlled `month`/`onMonthChange` state with sync to `selected` prop

One file. No new dependencies. No changes to any consumer component.

