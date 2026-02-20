
## Add Unsaved-Changes Guard to All Three "New Report" Screens

### The Problem

All three report-creation screens — New Daily Assessment, New Training, and New Inspection — currently call `goBack(navigate)` directly with no guard. If a user has started filling in fields and accidentally taps the back button (or uses a browser/native back gesture), all entered data is silently discarded.

The Cancel button in each form also navigates to `/dashboard` with no guard.

### The Fix

Wire a lightweight "Discard Unsaved Changes?" confirmation dialog into all three screens. Because these are *creation* screens (no record exists yet), there is nothing to "Save & Exit" — the only two actions are "Stay on Page" or "Discard & Go Back". This is simpler than the `SaveBeforeLeaveDialog` used in the full report forms.

A new shared component `DiscardDraftDialog` will be created — or the existing `SaveBeforeLeaveDialog` reused without the Save button — and integrated into all three screens.

---

### Files to Change

#### 1. `src/components/DiscardDraftDialog.tsx` — NEW component

A dedicated dialog for creation screens. Matches the existing glassmorphism aesthetic exactly:
- Dark frosted glass background: `bg-slate-900/95 backdrop-blur-xl border border-white/20`
- Title: "Discard Unsaved Changes?" with amber warning icon
- Body: "Any information you've entered will be lost."
- **Primary action**: "Stay on Page" — dark/neutral button (keeps the user on the page)
- **Secondary action**: "Discard & Go Back" — destructive/muted border button (confirms discarding)

No "Save" button because there is no persisted record to save yet.

#### 2. `src/pages/NewDailyAssessment.tsx`

- Add `showDiscardDialog` boolean state.
- Compute `hasChanges` = `formData.organization.trim() || formData.site.trim()`.
- Change back button `onClick` from `() => goBack(navigate)` to a guarded handler:
  - If `hasChanges` → `setShowDiscardDialog(true)`
  - Else → `goBack(navigate)`
- Change Cancel button the same way.
- Render `<DiscardDraftDialog>` at the bottom of the return, passing `onDiscard={() => goBack(navigate)}`.

#### 3. `src/pages/NewTraining.tsx`

- Same pattern as above.
- `hasChanges` = `formData.organization.trim() || formData.site.trim()`
- Guard both back button and Cancel button.
- Render `<DiscardDraftDialog>`.

#### 4. `src/pages/NewInspection.tsx`

- Same pattern.
- `hasChanges` = any of: `formData.organization`, `formData.location`, `formData.onsite_contact`, `formData.course_history`, `formData.previous_inspector` having a non-empty value.
- Guard both back button and Cancel button.
- Render `<DiscardDraftDialog>`.

---

### Dialog Design (matching existing glassmorphism style)

```
┌─────────────────────────────────────────┐
│ ⚠  Discard Unsaved Changes?             │  ← amber icon, white bold text
│                                         │
│ Any information you've entered will     │
│ be lost if you go back now.             │  ← slate-300 body text
│                                         │
│ [     Stay on Page      ]               │  ← full-width, dark neutral
│ [   Discard & Go Back   ]               │  ← full-width, destructive
└─────────────────────────────────────────┘
```

---

### Technical Notes

- No backend changes. No migrations. No new dependencies.
- `DiscardDraftDialog` reuses `AlertDialog` from `@radix-ui/react-alert-dialog` already installed and used throughout the app.
- The guard only activates when `hasChanges` is truthy — users who haven't typed anything can still navigate back instantly.
- The `useBlocker` hook from React Router is NOT used here because these screens don't have unsaved edits of a persisted record; the simpler state-driven dialog is sufficient and avoids the complexity of the blocker for creation flows.
- `goBack(navigate)` is preserved as the actual navigation call so the `navigationDepth` tracker continues to work correctly.
