

## Filter Reports by Specific Inspector/Trainer

### Current Behavior
The "All Inspectors" dropdown currently only offers sort options (A-Z, Z-A). It does not filter reports by a specific person.

### What Will Change
The dropdown will be populated with the actual names of inspectors/trainers who have created reports. Selecting a name will filter the report list to show only that person's reports. The "All Inspectors" option remains as the default (no filter). The A-Z/Z-A sort options are removed since filtering by person is more useful.

### How It Works

1. **Extract unique inspector names from loaded report data** -- no new database queries needed. The inspector/trainer profile data is already joined in the existing queries (`inspector.first_name`, `inspector.last_name` for inspections/daily assessments; `trainer.first_name`, `trainer.last_name` for trainings).

2. **Build a deduplicated, sorted list** of inspector names using a `useMemo` that combines names from all three report types (inspections, trainings, daily assessments), keyed by `inspector_id` to avoid duplicates.

3. **Update the Select dropdown** to show each unique inspector/trainer as an option, with their `inspector_id` as the value.

4. **Apply filtering** at the `displayInspections`/`displayTrainings`/`displayDailyAssessments` level. When a specific inspector is selected, filter each list to only show reports where `inspector_id` matches.

5. **Empty state handling** -- if filtering results in zero reports for a tab, the existing empty state components already handle this gracefully.

### Technical Details

**File: `src/pages/Dashboard.tsx`**

- Add a `useMemo` that iterates `inspections`, `trainings`, and `dailyAssessments` arrays to build a `Map<string, string>` of `inspector_id -> full name`, then sort alphabetically.

- Update lines 1171-1173 (the `displayInspections`/`displayTrainings`/`displayDailyAssessments` computation) to add a `.filter()` step when `inspectorFilter` is not `"all"` -- filtering by `report.inspector_id === inspectorFilter`.

- Replace the Select options (lines 1198-1202) to render dynamic `SelectItem` entries from the computed inspector list, removing the static A-Z/Z-A options.

- Remove the A-Z/Z-A sort branches from all three tab sort functions (they become unnecessary once filtering by person is available).

