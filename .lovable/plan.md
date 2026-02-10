

# Add Pending Reports List to Sync Status Sheet

## What Changes

The existing "Sync Status" sheet (the one you showed in your screenshot) will be enhanced to show a list of **all** pending reports -- Inspections, Trainings, and Daily Assessments -- not just inspections.

## How It Works

### 1. `src/hooks/useAutoSync.tsx` -- Expose unsynced item lists

The `updateUnsyncedCounts` function already fetches all three types of unsynced records but discards the details and only stores the total count. We will expand the state to also store the individual arrays so the UI can list them.

- Add `unsyncedInspections`, `unsyncedTrainings`, `unsyncedAssessments` arrays to `AutoSyncState`
- Store the fetched arrays in `updateUnsyncedCounts` instead of discarding them
- Return the new arrays from the hook

### 2. `src/components/pwa/PWAProvider.tsx` -- Pass data through context

- Add `unsyncedTrainings` and `unsyncedAssessments` to `PWAContextType`
- Replace the hardcoded `unsyncedInspections: []` with the real data from `useAutoSync`
- Pass all three arrays into the context value

### 3. `src/hooks/usePWA.tsx` -- Update fallback defaults

- Add `unsyncedTrainings: []` and `unsyncedAssessments: []` to the fallback context

### 4. `src/components/pwa/SyncPulse.tsx` -- Render the full list

Replace the current inspections-only "Pending reports" section with a unified list showing all three types:

- Pull `unsyncedInspections`, `unsyncedTrainings`, `unsyncedAssessments` from `usePWA()`
- Render each item as a row with:
  - A small color-coded type label: **Inspection** (blue), **Training** (purple), **Assessment** (amber)
  - Organization/location name (where available)
  - Temp-ID indicator if applicable
- Group all items in one scrollable list under "Pending reports (N)"

The design stays minimal and consistent with the existing sheet layout -- just rows with a left border and a type label added.

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useAutoSync.tsx` | Store unsynced item arrays in state, return them |
| `src/components/pwa/PWAProvider.tsx` | Add training/assessment arrays to context type and value |
| `src/hooks/usePWA.tsx` | Add fallback defaults for new arrays |
| `src/components/pwa/SyncPulse.tsx` | Render all three report types in the pending list |
