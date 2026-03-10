

# Plan: Add Alphabetical & Facility Filters to Dashboard

## Overview

Add two new filter controls to the existing dashboard filter bar:
1. **Alphabetical filter** — clickable A-Z letter chips that filter reports where the organization name starts with the selected letter
2. **Facility filter** — a dropdown that lists all unique facility locations from the current report set, allowing single-select filtering

Both filters integrate into the existing `useDashboardFilters` hook and `DashboardFilters` component.

## Changes

### 1. `src/hooks/useDashboardFilters.tsx` — Extend filter state and logic

- Add two new fields to `DashboardFilterState`:
  - `alphabeticalFilter: string` (empty string = no filter, otherwise a single letter like `"A"`)
  - `facilityFilter: string` (empty string = no filter, otherwise a facility/location name)
- Update `clearAllFilters` to reset both new fields
- Update `hasActiveFilters` to include them
- Add two new filter steps in the `useMemo` pipeline (after text search, before status filter):
  - **Alphabetical**: `filtered = filtered.filter(r => getOrganization(r).toUpperCase().startsWith(alphabeticalFilter))`
  - **Facility**: `filtered = filtered.filter(r => getLocation(r) === facilityFilter)`

### 2. `src/components/dashboard/DashboardFilters.tsx` — Add UI controls

- Add an **A-Z letter row**: horizontally scrollable row of small letter-chip buttons (A through Z + "All"). Clicking a letter sets `alphabeticalFilter`. Active letter gets primary styling, matching existing status pill pattern.
- Add a **Facility dropdown**: a `Select` component populated with unique locations extracted from reports (passed as prop). Shows "All Facilities" as default.
- New props: `alphabeticalFilter`, `onAlphabeticalChange`, `facilityFilter`, `onFacilityChange`, `uniqueFacilities: string[]`

### 3. `src/components/dashboard/DashboardReportsSection.tsx` — Wire new filters

- Compute `uniqueFacilities` from `currentReports` via `useMemo` (deduplicated, sorted location strings)
- Pass new filter values and handlers from `useDashboardFilters` down to `DashboardFilters`

### Files Modified
| File | Change |
|------|--------|
| `src/hooks/useDashboardFilters.tsx` | Add `alphabeticalFilter` + `facilityFilter` to state, filtering logic, clear/hasActive |
| `src/components/dashboard/DashboardFilters.tsx` | Add A-Z letter chips + Facility dropdown UI |
| `src/components/dashboard/DashboardReportsSection.tsx` | Compute unique facilities, wire new props |

No database changes. No new dependencies. Pure client-side filtering on already-loaded report data.

