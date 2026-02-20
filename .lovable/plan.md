
## Add "Complete Report" Confirmation Dialog to All Three Report Types

### What the user sees today
- **Daily Assessment**: Clicking "Complete" already shows a confirmation dialog ("Submit Assessment" / "Are you sure...") before finalizing.
- **Inspection Report**: Clicking "Complete Report" immediately fires `completeInspection()` — no confirmation step.
- **Training Report**: Clicking "Complete" immediately fires `completeTraining()` — no confirmation step.

### Goal
Every report type must show an identical "Submit [Report Type]" confirmation dialog before marking it as complete.

---

### Changes Required

#### 1. `src/pages/InspectionForm.tsx`

**State** — add one new state variable:
```tsx
const [showCompleteDialog, setShowCompleteDialog] = useState(false);
```

**Imports** — add `AlertDialog` components (not currently imported):
```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
```

**Button** (line 2249) — change `onClick={completeInspection}` to `onClick={() => setShowCompleteDialog(true)}`

**Dialog** — add the `AlertDialog` block just before the closing `</> ` of the return statement:
```tsx
<AlertDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Complete Inspection Report</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to mark this inspection as complete? This will lock the report. You can still edit it afterward if needed.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={completeInspection}>
        Complete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

---

#### 2. `src/pages/TrainingForm.tsx`

Same pattern:

**State** — add:
```tsx
const [showCompleteDialog, setShowCompleteDialog] = useState(false);
```

**Imports** — add `AlertDialog` components (not currently imported).

**Button** (line 1193) — change `onClick={completeTraining}` to `onClick={() => setShowCompleteDialog(true)}`

**Dialog** — add the same `AlertDialog` block before the return's closing fragment, with label "Complete Training Report".

---

#### 3. `src/pages/DailyAssessmentForm.tsx`

No changes needed — this file already has the `showSubmitDialog` state, the `AlertDialog`, and the button correctly wired to `setShowSubmitDialog(true)`.

---

### Technical Notes

- No backend changes required.
- No new components — uses the existing `AlertDialog` from `@radix-ui/react-alert-dialog` (already installed, already used in DailyAssessmentForm).
- The actual `completeInspection` / `completeTraining` functions are not modified — they remain the source of truth for save logic, confetti, and haptic feedback.
- The dialog's "Cancel" button simply closes the dialog without side effects.
- The styling of the dialog will match the existing default system dialog style (same as Daily Assessment — clean white modal with Cancel / Complete buttons).
