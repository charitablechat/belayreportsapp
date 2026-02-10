
# Make Creation Dates Read-Only After Report Creation

## Overview

Lock three date fields so they cannot be changed once a report exists. These dates represent when the report was created and must remain immutable. The fix is purely at the presentation layer -- rendering the date pickers as disabled buttons that display the persisted date.

## Changes

### 1. Training Report -- `start_date` (`src/components/training/TrainingHeader.tsx`)

**Current**: The Start Date Popover trigger is disabled only when `isReadOnly` is true (completed reports or non-owner access).

**Change**: Make the Start Date trigger **always disabled** by hardcoding `disabled` on the button and removing the `PopoverContent` render block for `start_date`. The existing `bg-muted/50 cursor-not-allowed` styling used by other disabled fields (e.g., Trainer of Record) will be applied to match the calm, muted aesthetic.

- Line 62-69: Add `disabled` (unconditional) to the trigger Button, add `className` with `bg-muted/50 cursor-not-allowed` styling
- Lines 74-84: Remove the entire `PopoverContent` block for start_date (calendar no longer renders)

### 2. Inspection Report -- `inspection_date` (`src/components/inspection/InspectionHeader.tsx`)

**Current**: The Inspection Date Popover (lines 135-159) is fully interactive unless `isReadOnly`.

**Change**: Make the trigger button **always disabled**, remove the `PopoverContent` block. Apply the muted field card styling already in use by the Inspector field (`bg-muted/50 cursor-not-allowed`).

- Line 139: Change `disabled={isReadOnly}` to `disabled` (always)
- Lines 146-158: Remove the `PopoverContent` block entirely

### 3. Daily Course Assessment -- `assessment_date` (`src/components/daily-assessment/DailyAssessmentHeader.tsx`)

**Current**: The Date Popover (lines 39-68) is interactive unless `isReadOnly`.

**Change**: Same pattern -- always disable the trigger, remove the `PopoverContent` block, apply muted styling.

- Line 47: Change `disabled={isReadOnly}` to `disabled` (always)
- Lines 57-67: Remove the `PopoverContent` block entirely

## Visual Consistency

All three disabled date buttons will use the same styling pattern already established in the codebase for immutable fields:
- `disabled` prop on the Button
- `bg-muted/50 cursor-not-allowed` className additions
- The CalendarIcon remains visible but muted (inherits disabled opacity)
- No new colors, borders, or visual elements introduced

## What Does NOT Change

- End Date on Training remains editable (not in scope)
- Previous Inspection Date remains editable
- Next Inspection Date remains editable
- No database or edge function changes required
- No new components or dependencies
