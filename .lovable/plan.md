

## Update Destructive Button Text to "Exit Without Saving"

### Scope

Two dialog components display a red destructive action button in the warning modal. Both will have their button text updated to **"Exit Without Saving"**. No styling, logic, or layout changes.

### Changes

| File | Current Text | New Text |
|------|-------------|----------|
| `src/components/UnsavedChangesDialog.tsx` (line 55) | "Discard any Changes & Exit" | "Exit Without Saving" |
| `src/components/SaveBeforeLeaveDialog.tsx` (line 59) | "Discard & Exit" | "Exit Without Saving" |

### Not Changed

- `DiscardDraftDialog.tsx` -- uses an outline-styled button ("Discard & Go Back"), not a red destructive button, and serves a different purpose (new draft creation screens). Left as-is.
- All button styling, icons, click handlers, and component props remain unchanged.

