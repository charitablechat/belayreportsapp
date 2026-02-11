

# Fix: Duplicate Month/Year Display in Calendar Date Picker

## Problem

The Calendar component uses `captionLayout="dropdown-buttons"` which causes `react-day-picker` to render both:
1. A static `caption_label` ("February 2026") 
2. The dropdown selects for month and year ("February v 2026 v")

This results in the month/year appearing twice, as shown in the screenshot.

## Fix

A single-line change in `src/components/ui/calendar.tsx`: hide the `caption_label` by changing its class from `"text-sm font-medium"` to `"text-sm font-medium hidden"`.

The dropdown selects already provide touchable/clickable month and year selection, so hiding the redundant static label gives us exactly the desired behavior -- one display, fully interactive.

## Scope

- **Only file changed**: `src/components/ui/calendar.tsx` (line 22)
- **Zero impact on data**: This is a purely cosmetic CSS class change. No state, props, callbacks, save logic, or sync behavior is touched.
- All date pickers across the app (Inspection, Training, Daily Assessment, Previous Inspection Date) use this shared Calendar component and will benefit from this fix consistently.

