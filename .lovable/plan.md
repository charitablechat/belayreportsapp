
# Add Month/Year Dropdown Navigation to All Calendar Date Pickers

## Approach

`react-day-picker` v8 (already installed) has built-in dropdown navigation via the `captionLayout` prop. By setting this in the shared `Calendar` component, every date picker in the app gets month/year dropdowns automatically -- no new libraries or per-component changes needed.

## Changes

### `src/components/ui/calendar.tsx` (single file)

Add three props to the `DayPicker` component:

- `captionLayout="dropdown-buttons"` -- shows both month/year dropdowns AND prev/next arrow buttons
- `fromYear={2000}` -- earliest selectable year (covers all reasonable production/inspection dates)
- `toYear={2035}` -- latest selectable year (future inspections/training)

These are set as defaults but can be overridden by any consuming component via spread props.

Add classNames for the dropdown selects to ensure they look consistent with the existing design:

- `caption_dropdowns` -- flex layout for the two dropdowns
- `dropdown_month`, `dropdown_year` -- styling for the select elements
- `dropdown` -- base select styling

### Day grid remains unchanged

The standard calendar day grid is untouched -- users still tap a day to select it. The dropdowns only replace the month/year caption navigation.

### No other files change

All 6 components that use `Calendar` (InspectionHeader, SummarySection, PreviousInspectionDatePicker, TrainingHeader, TrainingSummarySection, DailyAssessmentHeader) inherit this behavior automatically since they all import from `@/components/ui/calendar`.

## Technical Details

```text
Before:  [<]  February 2026  [>]     (arrows only)
After:   [<]  [February v] [2026 v]  [>]  (dropdowns + arrows)
```

The dropdowns are native `<select>` elements rendered by react-day-picker, which provide smooth, native scrolling on both mobile (iOS scroll wheel) and desktop (click to open list). No custom scroll library needed.

## Risk Assessment

- Zero risk to data persistence -- this is purely a caption layout change
- No backend changes
- No new dependencies
- All existing `onSelect` callbacks and date formatting remain identical
