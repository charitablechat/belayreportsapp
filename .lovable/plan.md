
# Fix: Add Missing `onImmediateSave` to Belay, Trolleys, and Other Equipment Tables

## Problem
The belay, trolleys, and other equipment tables lack the `onImmediateSave` prop. Data in these sections only persists via the 1.5s debounced auto-save. If a user navigates away before the timer fires, data is lost.

## Change

**File: `src/pages/InspectionForm.tsx`** (lines 2141-2158)

Add `onImmediateSave={triggerImmediateSave}` to all three components, matching the pattern already used by the other 5 equipment tables (harnesses, helmets, lanyards, connectors, rope).

| Component | Line | Change |
|-----------|------|--------|
| belay | 2141-2146 | Add `onImmediateSave={triggerImmediateSave}` |
| trolleys | 2147-2152 | Add `onImmediateSave={triggerImmediateSave}` |
| other | 2153-2158 | Add `onImmediateSave={triggerImmediateSave}` |

No other files need modification.
