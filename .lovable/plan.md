

## Show Read-Only State in Lovable Preview

### Problem
The `AutoSaveIndicator` correctly shows a "PREVIEW — READ ONLY" badge, but:
1. The Save Progress and Complete buttons are still visible
2. All form fields remain interactive
3. The `useReportEditPermission` hook doesn't check `isLovablePreview()`

The badge is rendered near the save/sync indicators but the buttons and fields aren't gated because `effectiveReadOnly` remains `false`.

### Solution
Add `isLovablePreview()` check to `useReportEditPermission` so it returns `isReadOnly: true` and `canEdit: false` in the preview environment. This single change will:
- Hide Save Progress and Complete buttons (gated by `!effectiveReadOnly`)
- Disable all form inputs (passed `isReadOnly` prop)
- Hide photo capture buttons
- Apply across all report types (Inspection, Training, Daily Assessment)

### Changes

**`src/hooks/useReportEditPermission.tsx`:**
- Import `isLovablePreview` from `@/lib/environment`
- At the top of the `useMemo`, if `isLovablePreview()` is true, return early:
  ```
  canEdit: false
  isReadOnly: true
  isOwner: false
  isSuperAdmin: false
  isLoading: false
  readOnlyReason: 'Preview mode — read-only'
  ```

This is a 5-line addition. No other files need changes — all three report forms already pass `effectiveReadOnly` (derived from `isReadOnly`) to their child components.

