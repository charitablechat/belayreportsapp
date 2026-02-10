
# Replace Plain Date Inputs with Calendar Date Pickers

## Problem

Two date fields in the inspection report still use the browser's native `<Input type="date">` instead of the consistent Popover + Calendar date picker used everywhere else. These native inputs look different across browsers/devices and don't match the app's design language.

## Affected Fields

1. **Inspection Date** in `src/components/inspection/InspectionHeader.tsx` (line 127) -- currently rendered via `renderField("Inspection Date", "inspection_date", ..., "date")`
2. **Next Inspection Date** in `src/components/inspection/SummarySection.tsx` (lines 82-93) -- currently a plain `<Input type="date">`

All other date fields in the app (Training start/end dates, submission date, assessment date, previous inspection date) already use the calendar picker pattern.

## Changes

### 1. `src/components/inspection/InspectionHeader.tsx`

- Import `Calendar`, `Popover`, `PopoverContent`, `PopoverTrigger`, `Button`, `CalendarIcon`, `format`, `cn`, and `parseLocalDate`
- Replace the `renderField("Inspection Date", ...)` call (line 127) with a Popover+Calendar date picker that:
  - Displays the current `inspection_date` formatted with `format(parseLocalDate(...), "PPP")`
  - On date selection, calls `onUpdate("inspection_date", format(date, "yyyy-MM-dd"))` followed by `onImmediateSave?.()`
  - Respects the `isReadOnly` flag by disabling the trigger and hiding the popover content
  - Defaults to today's date when opening if no date is set (via `defaultMonth`)

### 2. `src/components/inspection/SummarySection.tsx`

- Import `Calendar`, `Popover`, `PopoverContent`, `PopoverTrigger`, `Button`, `CalendarIcon`, `format`, `cn`, and `parseLocalDate`
- Replace the `<Input type="date">` block (lines 82-93) with a Popover+Calendar date picker that:
  - Displays the current `next_inspection_date` formatted nicely
  - On date selection, calls `updateField("next_inspection_date", format(date, "yyyy-MM-dd"))` followed by `onImmediateSave?.()`
  - Calls `onImmediateSave` when the popover closes (preserving existing save-on-blur behavior)

## Technical Details

Both replacements follow the exact same Popover+Calendar pattern already used in `TrainingHeader.tsx`, `DailyAssessmentHeader.tsx`, and `TrainingSummarySection.tsx`:

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground")}>
      <CalendarIcon className="mr-2 h-4 w-4" />
      {value ? format(parseLocalDate(value), "PPP") : "Pick a date"}
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-auto p-0">
    <Calendar
      mode="single"
      selected={parseLocalDate(value)}
      onSelect={(date) => onChange(date ? format(date, "yyyy-MM-dd") : "")}
      initialFocus
      className="pointer-events-auto"
    />
  </PopoverContent>
</Popover>
```

The `parseLocalDate` utility from `@/lib/date-utils` is used to avoid timezone-shift issues (parsing `YYYY-MM-DD` as local time rather than UTC).

## Result

All date fields across the entire application will use consistent, touch-friendly calendar pickers. No new UI features are introduced -- this simply standardizes the existing date input pattern.
