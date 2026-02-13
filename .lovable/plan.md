

# Speed Up Recent Reports Loading

## Root Cause

The dashboard queries use `SELECT *` on all three report tables. Each table has a `latest_report_html` column containing full HTML report content:

- **Trainings**: avg 2.8 MB per record x 8 records = ~22 MB
- **Daily Assessments**: avg 1.4 MB per record x 4 records = ~6 MB
- **Total unnecessary data transfer: ~28 MB**

The `ReportCard` component only needs a handful of lightweight columns (organization, date, status, inspector profile). The HTML is never displayed on the dashboard.

## Solution

Replace `SELECT *` with explicit column lists in all three dashboard loaders, excluding the heavy `latest_report_html` column. This alone should reduce load time dramatically (from ~28 MB to under 50 KB).

## Changes

### 1. Update `src/pages/Dashboard.tsx`

**loadInspections** (line 337): Replace `*` with explicit columns:
```
id, inspector_id, organization, location, inspection_date,
status, created_at, updated_at, synced_at, last_opened_at,
acct_number, started_at, latest_report_generated_at, report_version,
deleted_at, organization_id, previous_inspector, previous_inspection_date
```

**loadTrainingReports** (line 443): Replace `*` with explicit columns:
```
id, inspector_id, organization, trainer_of_record, start_date,
end_date, status, created_at, updated_at, synced_at,
latest_report_generated_at, report_version, deleted_at
```

**loadDailyAssessments** (line 544): Replace `*` with explicit columns:
```
id, inspector_id, organization, site, trainer_of_record,
assessment_date, status, created_at, updated_at, synced_at,
latest_report_generated_at, report_version, deleted_at
```

All three keep their existing `.is('deleted_at', null)` filter and profile joins unchanged.

### 2. Verify offline storage compatibility

The offline save calls (`saveInspectionOffline`, etc.) will cache the lighter records. When a user opens a report, the form fetches the full record independently, so no data is lost.

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Data transferred | ~28 MB | ~50 KB |
| Load time (good connection) | 3-8 seconds | under 1 second |
| Load time (slow mobile) | 10-15+ seconds | 1-2 seconds |

## Risk Assessment

- **Low risk**: The `latest_report_html` column is only used when generating/viewing reports, which happens in the individual form pages (InspectionForm, TrainingForm, DailyAssessmentForm) -- those already fetch their own data independently.
- The offline cache will store lighter records, but since forms re-fetch on open, there is no functional impact.

