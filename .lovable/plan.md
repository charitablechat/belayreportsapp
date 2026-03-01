
## Display Organization Instead of Site on Daily Assessment Report Cards

### Problem
In `ReportCard.tsx`, the `getReportOrganization()` function returns `report.site` for daily assessment cards. This causes the card title to show the Site name (e.g., "Marble Falls, TX") instead of the Organization name.

### Fix
One line change in `src/components/dashboard/ReportCard.tsx`, line 51:

```typescript
// Before
if (isDaily) return report.site;

// After
if (isDaily) return report.organization;
```

This is a pure display change -- no data, sync, or auth logic is affected. The `organization` field is already fetched and available on daily assessment records (confirmed by the recent work adding it to the header and report template).

### File Changed

| File | Change |
|------|--------|
| `src/components/dashboard/ReportCard.tsx` | Line 51: swap `report.site` to `report.organization` in `getReportOrganization()` |
