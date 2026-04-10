

# Fix: Invoice Button Label

The button currently shows "Invoiced" in both states. It should show **"Invoice"** when unselected and **"Invoiced ✓"** when selected.

## Changes

Three files need the label text updated:

### 1. `src/pages/InspectionForm.tsx` (line 2802)
Change: `{isInvoiced ? "Invoiced ✓" : "Invoiced"}` → `{isInvoiced ? "Invoiced ✓" : "Invoice"}`

### 2. `src/pages/TrainingForm.tsx` (line 1624)
Change: `{isMobile ? "" : (isInvoiced ? "Invoiced ✓" : "Invoiced")}` → `{isMobile ? "" : (isInvoiced ? "Invoiced ✓" : "Invoice")}`

### 3. `src/pages/DailyAssessmentForm.tsx` (line 1683)
Change: `{isMobileView ? "" : (isInvoiced ? "Invoiced ✓" : "Invoiced")}` → `{isMobileView ? "" : (isInvoiced ? "Invoiced ✓" : "Invoice")}`

Also update the dashboard `ReportCard.tsx` dropdown menu item (line ~180):
Change: `{isInvoiced ? 'Remove Invoice' : 'Mark Invoiced'}` → `{isInvoiced ? 'Remove Invoice' : 'Mark Invoice'}`

