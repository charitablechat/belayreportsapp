

# Admin-Only "Invoiced" Feature for Completed Reports

## Overview
Add an admin-only invoicing system: admins see an "Invoiced" button on completed report cards, which stamps the card with a red "INVOICED" crossing the green "COMPLETED" text, and moves the report into a new "Invoiced" tab visible only to admins.

## Database Changes

### New table: `invoiced_reports`
```sql
CREATE TABLE public.invoiced_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('inspection', 'training', 'daily')),
  invoiced_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invoiced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, report_type)
);

ALTER TABLE public.invoiced_reports ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write
CREATE POLICY "Admins can manage invoiced reports"
  ON public.invoiced_reports FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
```

This approach keeps invoiced state separate from the report `status` column — no risk of breaking existing logic.

## UI Changes

### 1. `ReportCard.tsx` — Invoiced stamp and button
- Accept new props: `isAdmin`, `isInvoiced`, `onToggleInvoiced`
- When `isAdmin && status === 'completed'`: show an "Invoiced" button (left of the status badge area) in the card's dropdown menu
- When `isInvoiced && isAdmin`: overlay a red "INVOICED" text rotated ~25deg (opposite direction to the green "COMPLETED") creating an X-shape over the card center
- Non-admins see only the existing green "COMPLETED" stamp — no change

### 2. `DashboardReportsSection.tsx` — New "Invoiced" tab
- Accept new prop: `invoicedReports` (Set of `report_id` strings)
- When `isSuperAdmin` (admin), add a 4th tab trigger: "Invoiced (N)" with a receipt icon
- The Invoiced tab shows all completed reports (across all types) that have an entry in `invoiced_reports`
- Each card in the Invoiced tab shows the type badge (Inspection/Training/Daily) so the user knows which type it is
- Filter the invoiced reports OUT of the normal Inspections/Training/Daily tabs (admin only)

### 3. `Dashboard.tsx` — Fetch invoiced data
- When user is admin: query `invoiced_reports` table to get the set of invoiced report IDs
- Pass `invoicedReports` set down to `DashboardReportsSection`
- Provide `onToggleInvoiced` callback that inserts/deletes from `invoiced_reports`
- For non-admins: skip the query entirely, pass empty set — no UI changes visible

### 4. Tab layout (admin view)
```text
┌─────────────┬──────────┬───────┬───────────┐
│ Inspections │ Training │ Daily │ Invoiced  │
│    (32)     │   (18)   │  (6)  │   (4)     │
└─────────────┴──────────┴───────┴───────────┘
```
The "Invoiced" tab only renders when the viewer is an admin/super_admin.

## Files Modified
1. **Migration** — Create `invoiced_reports` table with RLS
2. **`src/components/dashboard/ReportCard.tsx`** — Add invoiced stamp overlay + toggle in dropdown
3. **`src/components/dashboard/DashboardReportsSection.tsx`** — Add Invoiced tab (admin only), filter invoiced from other tabs
4. **`src/pages/Dashboard.tsx`** — Fetch invoiced set for admins, pass props, provide toggle handler

