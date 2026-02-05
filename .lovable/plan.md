
# Plan: Fix Super Admin Report Visibility - Disambiguate FK Relationships (v2.3.4)

## Root Cause Analysis

The v2.3.3 migration added a `last_modified_by` column to all three report tables (`inspections`, `trainings`, `daily_assessments`), creating a **second foreign key relationship** to the `profiles` table. 

When Dashboard.tsx queries use the ambiguous syntax `inspector:profiles(...)`, PostgREST returns a **HTTP 300 status** because it cannot determine which FK relationship to use:
- `inspector_id → profiles` (original)
- `last_modified_by → profiles` (new from v2.3.3)

**Console Error Evidence:**
```
PGRST201: Could not embed because more than one relationship was found 
for 'inspections' and 'profiles'

Hint: Try changing 'profiles' to one of the following:
- 'profiles!inspections_inspector_id_profiles_fkey'
- 'profiles!inspections_last_modified_by_fkey'
```

The queries fail silently and fall back to offline storage, which only contains the **current user's data** - hence Super Admins only see their own reports.

---

## Solution

Update all ambiguous profile join queries in `Dashboard.tsx` to use **explicit FK relationship hints** using PostgREST's `!foreign_key_name` syntax.

---

## Technical Changes

### File: `src/pages/Dashboard.tsx`

**Change 1: Inspections Query (Lines ~299-302)**

Before:
```typescript
.select(`
  *,
  inspector:profiles(first_name, last_name, avatar_url)
`)
```

After:
```typescript
.select(`
  *,
  inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name, avatar_url)
`)
```

**Change 2: Trainings Query (Lines ~370-373)**

Before:
```typescript
.select(`
  *,
  trainer:profiles(first_name, last_name, avatar_url)
`)
```

After:
```typescript
.select(`
  *,
  trainer:profiles!trainings_inspector_id_profiles_fkey(first_name, last_name, avatar_url)
`)
```

**Change 3: Daily Assessments Query (Lines ~437-440)**

Before:
```typescript
.select(`
  *,
  inspector:profiles(first_name, last_name, avatar_url)
`)
```

After:
```typescript
.select(`
  *,
  inspector:profiles!daily_assessments_inspector_id_profiles_fkey(first_name, last_name, avatar_url)
`)
```

---

### File: `vite.config.ts`

Update version to **2.3.4** with changelog comment.

---

## Files to Modify

| File | Lines | Description |
|------|-------|-------------|
| `src/pages/Dashboard.tsx` | ~299-302 | Fix inspections query FK hint |
| `src/pages/Dashboard.tsx` | ~370-373 | Fix trainings query FK hint |
| `src/pages/Dashboard.tsx` | ~437-440 | Fix daily_assessments query FK hint |
| `vite.config.ts` | Version | Bump to 2.3.4 |

---

## Why This Fixes the Issue

1. **No Database Changes Required** - The RLS policies are already correct; Super Admins have `SELECT` permission on all reports
2. **No Caching Issues** - The problem is query failure, not stale data
3. **InspectionForm.tsx Already Uses This Pattern** - Line 769 shows the working syntax: `profiles!inspections_inspector_id_profiles_fkey`

---

## Verification

After this fix, the network request for inspections will succeed with HTTP 200 instead of HTTP 300, and Super Admins will see all reports from all users.

---

## Impact on Image Upload

This fix is completely isolated to the Dashboard's read queries and has **no impact** on image upload functionality (which was stabilized in v2.2.99). The image upload code paths do not involve profile joins.

---

## Testing Checklist

1. Super Admin sees all inspections from all users on Dashboard
2. Super Admin sees all trainings from all users on Dashboard  
3. Super Admin sees all daily assessments from all users on Dashboard
4. Regular users still see only their own reports
5. Report cards display correct inspector/trainer names and avatars
6. Image uploads continue to work correctly (regression test)
