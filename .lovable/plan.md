

# Add "Invoiced" Button to Report Form Pages (Next to Generate Report)

## Overview
Add an "Invoiced" toggle button to the right of the "Generate Report" button on all three completed report forms (Inspection, Training, Daily Assessment). Only visible to admins/super admins. Toggles the invoiced state in the existing `invoiced_reports` table.

## Changes

### 1. `src/pages/InspectionForm.tsx`
- Destructure `isAdmin` from the existing `useReportEditPermission` hook (already available, just not destructured)
- Query `invoiced_reports` table to check if this report is invoiced (when admin + completed)
- Add an "Invoiced" button after the Generate Report button (line ~2770), visible only when `isAdmin && status === 'completed'`
- Button toggles between "Mark Invoiced" (outline style) and "Invoiced ✓" (red/destructive style)
- On click: insert or delete from `invoiced_reports`

### 2. `src/pages/TrainingForm.tsx`
- Same pattern: destructure `isAdmin`, query invoiced state, add button after Generate Report (line ~1600)

### 3. `src/pages/DailyAssessmentForm.tsx`
- Same pattern: add button after Generate Report (line ~1661)

### Button Design
- Uninvoiced state: `variant="outline"` with Receipt icon + "Invoiced" text (hidden on mobile)
- Invoiced state: `variant="outline"` with red text/border, Receipt icon + "Invoiced ✓"
- Uses the existing `Receipt` icon from lucide-react

