

## Organization Reports Modal

### Current State
The feature partially exists: clicking an organization row opens `OrganizationReportsPanel` **inline below the table**. This can be easy to miss and pushes content down. The user wants a proper modal/dedicated view.

### Plan

**1. Convert inline panel to a Sheet (slide-over dialog)**

File: `src/pages/SuperAdminDashboard.tsx`
- Replace the inline `{selectedOrgForReports && <OrganizationReportsPanel ... />}` block with a `<Sheet>` component
- The Sheet opens from the right, overlaying the organization table without displacing it
- Sheet header shows organization name; close button dismisses it

**2. Enhance `OrganizationReportsPanel` for modal context**

File: `src/components/admin/OrganizationReportsPanel.tsx`
- Remove the back button (Sheet handles dismissal)
- Add a search/filter input at the top to filter reports by name, date, or status across all three sections
- Add sort toggle (newest/oldest) for each collapsible section
- Keep the existing collapsible sections (Inspections, Trainings, Daily Assessments) with their tables

### Files
| File | Change |
|------|--------|
| `src/pages/SuperAdminDashboard.tsx` | Wrap `OrganizationReportsPanel` in a `Sheet` component instead of rendering inline |
| `src/components/admin/OrganizationReportsPanel.tsx` | Remove back button, add search filter input and sort controls |

