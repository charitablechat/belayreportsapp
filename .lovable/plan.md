

## Auto-Populate ACCT# from User Profile on New Inspection

### Problem
When an inspector creates a new inspection, the ACCT# field is empty. The profile table already stores `acct_number` per user, but `NewInspection.tsx` doesn't fetch or include it.

### Fix

**File: `src/pages/NewInspection.tsx`**

1. Add `acct_number` to the initial `formData` state (default `""`).
2. In the existing `fetchUserProfile` effect (line 43-71), expand the `.select()` to include `acct_number` and set it into formData.
3. Include `acct_number` in `cleanedFormData` (line 178) so it's sent to the database on insert.
4. Add `acct_number` to the `newInspection` object (line 167) for offline creation.

This is a small, contained change — only touches the NewInspection page. The ACCT# field already exists on the InspectionHeader for editing; this just pre-fills it from the profile at creation time.

