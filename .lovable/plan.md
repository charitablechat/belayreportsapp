

# Auto-Populate "Person Submitting Form" with Report Creator's Name

## Problem

The current auto-populate logic for the "Person Submitting Form" field fetches the **currently logged-in user's** profile. This means if a Super Admin opens the training report, the field would incorrectly populate with the Super Admin's name instead of the original report creator's name.

## Solution

Replace the standalone `useEffect` (lines 230-276) that fetches the current user's profile with logic that uses the already-available `inspectorProfile` state (the report creator's profile, fetched at lines 167-180).

## Changes

### 1. Update `src/pages/TrainingForm.tsx`

**Remove** the `useEffect` block at lines 230-276 that fetches the current user's profile for auto-population.

**Replace** with a simpler `useEffect` that uses the existing `inspectorProfile` (report creator):

```typescript
useEffect(() => {
  if (!summary || isLoading || !inspectorProfile) return;

  const updates: any = {};

  if (!summary.person_submitting) {
    const fullName = [inspectorProfile.first_name, inspectorProfile.last_name]
      .filter(Boolean)
      .join(' ');
    if (fullName) {
      updates.person_submitting = fullName;
    }
  }

  if (!summary.submission_date) {
    updates.submission_date = format(new Date(), 'yyyy-MM-dd');
  }

  if (Object.keys(updates).length > 0) {
    isInternalUpdateRef.current = true;
    setSummary({ ...summary, ...updates });
  }
}, [summary?.id, isLoading, inspectorProfile]);
```

**Key behavioral differences from the current code:**
- Uses `inspectorProfile` (the report creator) instead of the current logged-in user
- No additional network request needed -- the profile is already fetched
- Dependency on `inspectorProfile` ensures the effect runs once the creator's profile is available
- The field remains manually editable so users can override if needed

## Technical Notes

- No database changes required
- No new dependencies
- The `inspectorProfile` fetch already has an offline guard (`navigator.onLine`), so offline scenarios are handled (the field simply stays empty until the profile loads)
- The `isInternalUpdateRef` flag prevents this auto-population from triggering unsaved-changes warnings
- Only a single file is modified; zero risk to other report types

