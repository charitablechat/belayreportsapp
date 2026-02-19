

# Active-Usage Timer: High-Precision Completion Tracking

## Overview
Replace the current wall-clock completion time metric (started_at -> updated_at) with an **active-duration tracker** that only counts time when users are actively working on a report. This includes a retro-tech terminal display widget and a database schema update.

## Architecture

### 1. Database Migration: Add `active_duration_seconds` column
Add an integer column to `inspections`, `trainings`, and `daily_assessments` tables:
```sql
ALTER TABLE inspections ADD COLUMN active_duration_seconds integer DEFAULT 0;
ALTER TABLE trainings ADD COLUMN active_duration_seconds integer DEFAULT 0;
ALTER TABLE daily_assessments ADD COLUMN active_duration_seconds integer DEFAULT 0;
```
- Nullable: No, default 0
- No foreign keys, no RLS changes needed (existing per-user and super-admin policies already cover UPDATE/SELECT)

### 2. New Hook: `src/hooks/useActiveTimer.tsx`
A custom hook managing active usage tracking with the following logic:

- **State**: `elapsedSeconds` (accumulated), `isActive` (currently tracking), `isPaused` (idle timeout hit)
- **Initialization**: Accepts `initialSeconds` (from DB) and `enabled` flag. Starts on mount when `enabled=true`.
- **Activity Detection**: Listens for `keydown`, `mousedown`, `touchstart`, `input`, `change` events on `document`. Each event resets a 30-second idle debounce timer.
- **Idle Logic**: If no activity for 30 seconds, pause the internal interval. Resume immediately on next detected activity.
- **Window Focus**: Pause when `document.visibilityState === 'hidden'`; resume tracking on focus return (with activity).
- **Tick**: Uses a 1-second `setInterval` that only increments `elapsedSeconds` when `isActive && !isPaused`.
- **Persistence Callback**: Exposes `getElapsedSeconds()` for the parent form to include in its save payload. Does NOT perform its own DB writes -- piggybacks on existing save logic.
- **Cleanup**: Removes all listeners and clears interval on unmount.
- **No sensitive data**: The hook only deals with a numeric counter. No auth tokens or session data.

Returns: `{ elapsedSeconds, isActive, isPaused, getElapsedSeconds, reset }`

### 3. New Component: `src/components/ActiveTimerDisplay.tsx`
A retro-tech terminal-style timer display:

- **Placement**: Rendered inside each report form (InspectionForm, TrainingForm, DailyAssessmentForm), positioned in the top area near the existing save indicator.
- **Styling**:
  - Monospaced font: `font-mono` (system monospace; JetBrains Mono as a nice-to-have via Google Fonts import in index.css)
  - Lime green text `text-[#32CD32]` on dark charcoal background `bg-[#1a1a1a]`
  - Rounded pill shape with subtle border `border-[#32CD32]/30`
  - Compact size to not disrupt existing layout
- **Content**: `HH:MM:SS` formatted elapsed time
- **Status Badge**: A small "REC" indicator dot that pulses/blinks when active, dims when paused
- **Blinking Cursor**: A `_` character after the time with a CSS blink animation
- **Read-Only Mode**: When `isReadOnly`, show the stored duration without ticking

### 4. Integration into Report Forms
For each form (`InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`):

- **Load**: Read `active_duration_seconds` from the fetched report data and pass as `initialSeconds` to `useActiveTimer`.
- **Save**: Include `active_duration_seconds: getElapsedSeconds()` in the existing save payload (both local IndexedDB save and remote upsert). This piggybacks on the existing auto-save and manual save flows -- no new save operations.
- **Enable Condition**: Only track when `canEdit && !isReadOnly` (owners editing their own reports).
- **Render**: Add `<ActiveTimerDisplay>` near the existing `<AutoSaveIndicator>`.

### 5. SuperAdmin Dashboard Update (`src/pages/SuperAdminDashboard.tsx`)
Update the "Avg Completion Time" query to prefer `active_duration_seconds` when available:

- If `active_duration_seconds > 0`, use it directly (convert to hours).
- Otherwise, fall back to the existing `started_at -> updated_at` wall-clock calculation.
- Update the hover tooltip to indicate "active time" vs "wall-clock time" distinction.

### 6. CSS Addition (`src/index.css`)
Add a blink keyframe animation for the cursor effect:
```css
@keyframes terminal-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
```

## Files to Create
1. `src/hooks/useActiveTimer.tsx` -- the active-usage tracking hook
2. `src/components/ActiveTimerDisplay.tsx` -- the retro terminal timer widget

## Files to Modify
1. `src/index.css` -- add terminal-blink keyframe + optional JetBrains Mono import
2. `src/pages/InspectionForm.tsx` -- integrate hook + display component + include in save payload
3. `src/pages/TrainingForm.tsx` -- same integration
4. `src/pages/DailyAssessmentForm.tsx` -- same integration
5. `src/pages/SuperAdminDashboard.tsx` -- update avg completion time query to prefer active_duration_seconds

## Database Migration
- Add `active_duration_seconds` (integer, default 0) to 3 tables

## Security Notes
- No auth tokens, session IDs, or API keys are used or exposed in the timer hook or display component
- The `active_duration_seconds` field is protected by existing RLS policies (owner-only UPDATE, super-admin SELECT)
- The hook is purely a numeric counter with DOM event listeners -- no network calls of its own

## Data Safety
- Existing IndexedDB persistence, emergency save, and WAL snapshot patterns are untouched
- The new field is simply added to the existing save payloads
- Backward compatible: `DEFAULT 0` means all existing reports start with 0 active seconds and fall back to wall-clock calculation

