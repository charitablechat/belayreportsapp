

## Show Timestamp Only on Manual Save

### Problem
Currently, `lastSaved` is updated by auto-save, immediate save (checkbox/date), AND manual save — all feeding the same visible `AutoSaveIndicator`. The user wants the visible timestamp to reflect **only** explicit manual saves (button click or Ctrl/Cmd+S).

### Approach
Add a separate `lastManuallySaved` state in each form. Only manual save paths update it. Pass this to `AutoSaveIndicator` instead of `lastSaved`. Auto-save continues to update the internal `lastSaved` (used for `hasUnsavedChanges` tracking) but no longer drives the visible indicator. Update the label to say "Manually Saved".

### Changes

**`src/components/AutoSaveIndicator.tsx`**
- Change the "Saved" label to "Manually Saved" for desktop and mobile variants
- No prop changes needed — the forms will simply pass the manual timestamp

**`src/pages/InspectionForm.tsx`**
1. Add state: `const [lastManuallySaved, setLastManuallySaved] = useState<Date | null>(null)`
2. In `saveProgress()` (the manual save function, ~line 1867): also call `setLastManuallySaved(new Date())`
3. In `autoSaveProgress()` (~line 1827): keep `setLastSaved(new Date())` but do NOT set `lastManuallySaved`
4. In `triggerImmediateSave()` (~line 1785): same — do NOT set `lastManuallySaved`
5. In load completion (~line 1235): do NOT set `lastManuallySaved`
6. Pass `lastManuallySaved` to `<AutoSaveIndicator lastSaved={lastManuallySaved} ...>` instead of `lastSaved`

**`src/pages/TrainingForm.tsx`**
1. Add `lastManuallySaved` state
2. Only set it in the manual `saveTraining()` path
3. Pass `lastManuallySaved` to `AutoSaveIndicator`

**`src/pages/DailyAssessmentForm.tsx`**
1. Add `lastManuallySaved` state
2. Only set it in the manual save path
3. Pass `lastManuallySaved` to `AutoSaveIndicator`

**`src/hooks/useKeyboardShortcuts.tsx`**
- No change needed — `useSaveShortcut` already calls `saveProgress`/`saveTraining` which is the manual path

### What stays the same
- Auto-save continues running on the 1.5s debounce — just doesn't update the visible timestamp
- `hasUnsavedChanges` tracking unchanged
- Emergency save unchanged
- `lastSaved` internal state still tracks all saves for logic purposes

