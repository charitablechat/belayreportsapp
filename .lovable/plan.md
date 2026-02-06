
# Fix: Profile Avatar Bug in Report Forms (v2.3.9)

## Problem Identified

When you view another user's report, the avatar in the top-right profile dropdown shows the **report owner's photo** instead of **your own photo**. This happens because the code uses a single variable (`userProfile`) for two different purposes.

## Root Cause

In `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx`:

| Variable | Current Use | Passed To |
|----------|-------------|-----------|
| `userProfile` | Report owner's profile (inspector/trainer) | Both `InspectionHeader` AND `UserProfileDropdown` |

The `UserProfileDropdown` needs the **current logged-in user's avatar**, but it receives the **report owner's avatar**.

## Solution

Separate the two profile states:

1. **`inspectorProfile`** - The report owner's profile (for showing in the report header)
2. **`currentUserProfile`** - The logged-in user's profile (for the avatar dropdown)

## Changes Required

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add `currentUserProfile` state, fetch current user's profile, pass correct profile to dropdown |
| `src/pages/TrainingForm.tsx` | Same pattern |
| `src/pages/DailyAssessmentForm.tsx` | Same pattern |

### Technical Implementation

For each form file, the changes are:

1. **Add new state** for current user's profile:
```typescript
const [inspectorProfile, setInspectorProfile] = useState<any>(null);  // Report owner
const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);  // Logged-in user
```

2. **Rename existing profile fetch** from `setUserProfile` to `setInspectorProfile`

3. **Add new useEffect** to fetch the current logged-in user's profile:
```typescript
useEffect(() => {
  const fetchCurrentUserProfile = async () => {
    if (!currentUser?.id || !navigator.onLine) return;
    
    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", currentUser.id)
      .maybeSingle();
    
    setCurrentUserProfile(profile);
  };
  
  fetchCurrentUserProfile();
}, [currentUser?.id]);
```

4. **Update component props**:
   - `InspectionHeader` receives `inspectorProfile` (report owner info - unchanged behavior)
   - `UserProfileDropdown` receives `currentUserProfile` (logged-in user's avatar - fixed!)

## Result

After this fix:
- The profile dropdown will **always show YOUR avatar**, regardless of whose report you're viewing
- The report header will continue to correctly show the report owner's name

## Version

Update to **v2.3.9**
