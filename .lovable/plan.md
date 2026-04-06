

# Fix Typing Lag in Forms

## Problem

Every keystroke in the Training and Daily Assessment forms causes a full parent re-render because:

1. **Direct parent state mutation on each key press**: Child components (e.g., `BeginningOfDaySection`, `TrainingSummarySection`) call `onUpdate()` on every keystroke, which calls `setTraining(...)`, `setBeginningOfDay(...)`, etc. in the parent form.
2. **`setHasUnsavedChanges(true)` on every change**: Both the `useEffect` auto-save watcher AND individual update handlers call `setHasUnsavedChanges(true)`, triggering an additional re-render of the entire 1800-line form.
3. **No debounced inputs**: Unlike InspectionForm which uses `DebouncedInput` for table cells, Training and Daily Assessment forms pass raw `<Input>`, `<VoiceInput>`, and `<VoiceTextarea>` components that propagate every keystroke to the parent.

The InspectionForm partially solved this with `DebouncedInput` (300ms local state) and `hasUnsavedRef` (prevents re-render from the unsaved flag), but the other two forms never adopted these patterns.

## Solution

Apply the same proven patterns from InspectionForm across all forms:

### 1. Add `hasUnsavedRef` guard to Training and Daily Assessment forms
Prevent `setHasUnsavedChanges(true)` from firing on every keystroke when the flag is already `true`. This eliminates one full parent re-render per keystroke.

**Files:** `TrainingForm.tsx`, `DailyAssessmentForm.tsx`

In the auto-save `useEffect`, replace `setHasUnsavedChanges(true)` with the ref-guarded pattern already used in InspectionForm:
```typescript
const hasUnsavedRef = useRef(false);
// In the useEffect:
if (!hasUnsavedRef.current) {
  hasUnsavedRef.current = true;
  setHasUnsavedChanges(true);
}
// After save completes, reset: hasUnsavedRef.current = false;
```

Also remove the redundant `setHasUnsavedChanges(true)` calls from individual update handlers (`handleBeginningOfDayUpdate`, `updateTrainingField`, `updateSummaryField`, etc.) since the `useEffect` watcher already handles this.

### 2. Use `DebouncedInput` in Training and Daily Assessment child components
Replace raw `<Input>` / `<VoiceInput>` usage in text-field-heavy sections with `DebouncedInput` or a new `DebouncedVoiceInput` wrapper. This keeps local state in the child and only propagates to the parent after 300ms or on blur.

**Files:** Training child components (`TrainingSummarySection.tsx`, `ImmediateAttentionSection.tsx`, `VerifiableItemsSection.tsx`, `SystemsInPlaceSection.tsx`), Daily Assessment child components (`BeginningOfDaySection.tsx`, `EndOfDaySection.tsx`, `EquipmentChecksSection.tsx`, `StructureChecksSection.tsx`, `EnvironmentChecksSection.tsx`)

### 3. Create `DebouncedTextarea` component
Same pattern as `DebouncedInput` but for `<Textarea>` (used in section comments and daily assessment comment fields). Local state + debounced parent propagation.

**File:** New `src/components/inspection/DebouncedTextarea.tsx`

### 4. Create `DebouncedVoiceInput` wrapper
Wraps `DebouncedInput` with the microphone button, matching `VoiceInput` API but with local debouncing.

**File:** New `src/components/ui/debounced-voice-input.tsx`

## Impact
- Each keystroke only updates local component state (fast, no parent re-render)
- Parent state updates are batched every 300ms
- `hasUnsavedChanges` state change happens at most once per edit session until saved
- Matches the existing proven pattern in InspectionForm

