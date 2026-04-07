

# Make Super Admin Strictly Read-Only on Others' Reports

## Problem
When you (super admin) open another user's report, the permission hook returns `canEdit: true, isReadOnly: false`, which allows saves, sets `last_modified_by`, and stores data locally under your account. You want complete invisibility — no writes, no traces.

## Current State (already correct)
- `last_opened_at` update: already gated on `isOwner` (InspectionForm line 1045)
- Auto-save (debounced + interval): already gated on `isOwner` in all 3 forms
- `last_modified_by`: only set inside `performSave`, which is blocked by auto-save guards
- Save Progress button: hidden when `effectiveReadOnly` is true
- Active timer: already disabled (`enabled: false`)

## What Needs to Change

### 1. `src/hooks/useReportEditPermission.tsx` (lines 156-167)

Change the super admin non-owner block from granting full edit access to strict read-only:

```tsx
// Super Admin viewing someone else's report - strictly read-only, no traces
if (isSuperAdmin) {
  return {
    canEdit: false,
    isReadOnly: true,
    isOwner: false,
    isSuperAdmin: true,
    isLoading: false,
    readOnlyReason: null
  };
}
```

Setting `readOnlyReason: null` avoids showing a banner — the super admin knows they're browsing. Setting `canEdit: false` and `isReadOnly: true` ensures:
- Save Progress button is hidden
- Auto-save never fires (already gated on `isOwner`, plus `effectiveReadOnly` blocks manual saves)
- No `last_modified_by` gets written
- No local IndexedDB writes occur
- All form fields render as disabled

This is a single-line-group change in one file. Delete capability is unaffected — it's handled separately via dashboard delete actions and RLS policies, not by `canEdit`.

