

## Change Red Button Text to "Exit — Nothing to Save"

### What's Changing
The destructive (red) button in the exit confirmation dialogs will be relabeled from **"Exit Without Saving"** to **"Exit — Nothing to Save"** across all report types.

### Files Changed

| File | Line | Change |
|------|------|--------|
| `src/components/SaveBeforeLeaveDialog.tsx` | 59 | `Exit Without Saving` → `Exit — Nothing to Save` |
| `src/components/UnsavedChangesDialog.tsx` | 55 | `Exit Without Saving` → `Exit — Nothing to Save` |

Two one-line text changes. No logic or layout changes.

