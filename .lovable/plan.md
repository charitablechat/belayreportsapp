

## Organization Reports Drill-Down

### What Changes
When a user clicks an organization row in the Organizations tab, it expands to show all associated reports (inspections, trainings, daily assessments) inline, grouped by type with collapsible sections.

### Implementation

**1. New component: `src/components/admin/OrganizationReportsPanel.tsx`**
- Accepts `organizationId` and `organizationName` props
- Uses three `useQuery` hooks to fetch inspections, trainings, and daily assessments filtered by `organization_id`
- Each query joins with `profiles` to get inspector/trainer name
- Renders three collapsible sections (using existing Collapsible component), each with a table showing: report title/type, date, inspector name, status badge
- Rows are clickable to navigate to the report (`/inspection/:id`, `/training/:id`, `/daily-assessment/:id`)
- Shows loading skeletons while fetching, empty states when no reports exist
- Includes a back/close button to deselect the organization

**2. Modify `src/pages/SuperAdminDashboard.tsx`**
- Add `selectedOrgForReports` state (`null | { id, name }`)
- Make organization rows clickable — clicking sets `selectedOrgForReports`
- When an org is selected, render `OrganizationReportsPanel` below the organizations table (or replace the table with the panel + a back button)
- Keep edit/delete buttons functional via `e.stopPropagation()` on those action buttons

### UI Layout
- Organization row click → table slides to show the panel below with the org name as header
- Three collapsible sections: "Inspections (X)", "Training Reports (X)", "Daily Assessments (X)"
- Each section contains a responsive table with columns: Name/Org, Date, Inspector, Status
- Mobile: stack key details, hide secondary columns via `hidden sm:table-cell`

### Files Modified
| File | Change |
|------|--------|
| `src/components/admin/OrganizationReportsPanel.tsx` | New — fetches and displays reports for a selected org |
| `src/pages/SuperAdminDashboard.tsx` | Add state + click handler + render panel |

