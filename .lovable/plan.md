
# Enable Date Field Editing Across All Report Forms

## Overview

All five date fields across three report forms are currently hardcoded as `disabled` with no calendar popover content. This plan re-enables them as editable fields with proper calendar selection, gated by the existing `isReadOnly` prop (which already respects completion lock and permission logic).

## Changes by File

### 1. `src/components/inspection/InspectionHeader.tsx`

**Inspection Date (lines 133-146):**
- Remove `disabled` from the Button; gate with `disabled={isReadOnly}` instead
- Remove forced `bg-muted/50 cursor-not-allowed` classes; apply them conditionally only when `isReadOnly`
- Add `PopoverContent` with a `Calendar` component (same pattern as existing End Date in TrainingHeader)
- On date select, call `onUpdate("inspection_date", format(date, 'yyyy-MM-dd'))` and trigger `onImmediateSave`

**Previous Inspection Date (lines 152-163):** Already editable via `PreviousInspectionDatePicker` -- no changes needed.

### 2. `src/components/training/TrainingHeader.tsx`

**Start Date (lines 58-74):**
- Remove `disabled` from the Button; gate with `disabled={isReadOnly}`
- Remove forced `bg-muted/50 cursor-not-allowed` classes; apply conditionally
- Add `PopoverContent` with `Calendar` (matching the existing End Date pattern on lines 86-98)
- On date select, call `onUpdate('start_date', format(date, 'yyyy-MM-dd'))`

**End Date (lines 77-100):** Already editable -- no changes needed.

### 3. `src/components/daily-assessment/DailyAssessmentHeader.tsx`

**Assessment Date (lines 38-57):**
- Remove `disabled` from the Button; gate with `disabled={isReadOnly}`
- Remove forced `bg-muted/50 cursor-not-allowed` classes; apply conditionally
- Add `PopoverContent` with `Calendar`
- On date select, call `onUpdate("assessment_date", format(date, 'yyyy-MM-dd'))`

## Implementation Pattern (same for all three)

```text
Before:
  <Button disabled className="bg-muted/50 cursor-not-allowed">
    ...date display...
  </Button>
  (no PopoverContent)

After:
  <Button disabled={isReadOnly} className={cn(isReadOnly && "bg-muted/50 cursor-not-allowed")}>
    ...date display...
  </Button>
  {!isReadOnly && (
    <PopoverContent className="w-auto p-0">
      <Calendar
        mode="single"
        selected={parsedDate}
        onSelect={(date) => onUpdate(field, date ? format(date, 'yyyy-MM-dd') : '')}
        initialFocus
        className="pointer-events-auto"
      />
    </PopoverContent>
  )}
```

## What Remains Unchanged

- Auto-populate logic for dates on report creation
- All data loss prevention (RLS, save/cancel, navigation blocking)
- Completion lock field interception (`onClickCapture`)
- `isReadOnly` gating from `useReportEditPermission`
- The `PreviousInspectionDatePicker` component (already editable)
- The Training End Date calendar (already editable)

## Files Changed

1. `src/components/inspection/InspectionHeader.tsx` -- Enable Inspection Date calendar
2. `src/components/training/TrainingHeader.tsx` -- Enable Start Date calendar
3. `src/components/daily-assessment/DailyAssessmentHeader.tsx` -- Enable Assessment Date calendar
