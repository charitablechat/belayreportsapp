

# Fix Duplicate Month/Year in Calendar on Mobile

## Problem

The `Calendar` component (`src/components/ui/calendar.tsx`) uses `captionLayout="dropdown-buttons"` which renders both a static caption label ("February 2026") AND interactive dropdown selectors. The static label is supposed to be hidden via `caption_label: "text-sm font-medium hidden"`, but on mobile it still renders, causing the month and year to appear twice as shown in the screenshot.

## Root Cause

The Tailwind `hidden` class can be overridden by other styles in the react-day-picker v8 rendering. Using `!hidden` (with the important modifier) ensures the static label is suppressed regardless of specificity conflicts.

## Fix

**File: `src/components/ui/calendar.tsx`** (single change)

| Line | Before | After |
|------|--------|-------|
| 22 | `caption_label: "text-sm font-medium hidden"` | `caption_label: "text-sm font-medium !hidden"` |

This uses Tailwind's `!important` modifier to guarantee the static caption label is hidden on all viewports, leaving only the interactive dropdown selectors visible.

## Impact Scope

All date pickers across all three report types use this shared `Calendar` component, so the fix automatically applies everywhere:

- **Inspection Form**: `InspectionHeader.tsx` (inspection date), `SummarySection.tsx` (next inspection date), `PreviousInspectionDatePicker.tsx` (previous inspection date)
- **Training Form**: `TrainingHeader.tsx` (start date), `TrainingSummarySection.tsx` (end date)
- **Daily Assessment Form**: `DailyAssessmentHeader.tsx` (assessment date)
- **New Inspection page**: `PreviousInspectionDatePicker` usage

## Data Integrity

This is a CSS-only change to a `classNames` prop. Zero impact on:
- Date selection logic or `onSelect` callbacks
- Data persistence / auto-save flows
- Sync timestamp alignment
- Systems/ziplines/equipment filtering or saving

