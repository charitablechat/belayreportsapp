

# Fix: Exclude Admin/SuperAdmin Users from Active Timer Recording

## Problem

The `useActiveTimer` hook is enabled by the condition `canEdit && !isReadOnly && !isCompletionLocked` in all three report forms. Since super admins currently receive `canEdit: true` and `isReadOnly: false` from the permission hook, the timer actively records duration during their auditing sessions. This inflates completion time metrics with non-user activity.

## Fix (3 files, 1-line change each)

Add `&& !isSuperAdmin` to the timer's `enabled` condition in each form. The `isSuperAdmin` value is already available -- it is destructured from `useReportEditPermission` in all three files.

### File 1: `src/pages/InspectionForm.tsx` (line 147)

```text
Before: enabled: canEdit && !isReadOnly && !isCompletionLocked,
After:  enabled: canEdit && !isReadOnly && !isCompletionLocked && !isSuperAdmin,
```

### File 2: `src/pages/TrainingForm.tsx` (line 110)

```text
Before: enabled: canEdit && !isReadOnly && !isCompletionLocked,
After:  enabled: canEdit && !isReadOnly && !isCompletionLocked && !isSuperAdmin,
```

### File 3: `src/pages/DailyAssessmentForm.tsx` (line 113)

```text
Before: enabled: canEdit && !isReadOnly && !isCompletionLocked,
After:  enabled: canEdit && !isReadOnly && !isCompletionLocked && !isSuperAdmin,
```

## What Does NOT Change

- The `useActiveTimer` hook itself -- no modifications needed
- The `ActiveTimerDisplay` component -- it will simply show a dormant state (gray dot, no REC) for admins
- The `useReportEditPermission` hook -- admin edit permissions remain intact
- Auto-save logic -- admins can still save; the timer just will not increment `active_duration_seconds`
- Dashboard analytics calculations in `SuperAdminDashboard.tsx`
- No new dependencies, no database changes

## Why This Works

The `isSuperAdmin` flag is already resolved by `useReportEditPermission` before the timer initializes. When `enabled` is `false`, the `useActiveTimer` hook skips all interval ticking, event listeners, and idle detection -- zero overhead. The timer display renders in its inactive state (gray indicator), giving admins a clear visual cue that their session is not being tracked.
