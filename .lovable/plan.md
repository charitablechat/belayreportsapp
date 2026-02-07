

# Plan: Ensure Inspector Name Always Shows Report Creator - v2.4.11

## Problem

The Inspector field in the form header shows "Current User" as a fallback when the inspector profile hasn't loaded yet or is unavailable (e.g., offline). Additionally, if only one of `first_name` or `last_name` is set (but not both), the name won't display due to the `&&` logic, falling back to "Current User" again.

## Solution

Fix the name resolution logic in `InspectionHeader.tsx` to:

1. Use `||` instead of `&&` so a user with only a first name or only a last name still displays correctly.
2. Add a "Loading..." fallback instead of "Current User" to make it clear the name is being fetched, not absent.
3. Show the profile email or "Inspector" as a last-resort fallback rather than the misleading "Current User" text.

## Technical Details

### File: `src/components/inspection/InspectionHeader.tsx`

**Lines 19-21** -- Change the name resolution logic:

Before:
```typescript
const inspectorName = userProfile?.first_name && userProfile?.last_name
  ? `${userProfile.first_name} ${userProfile.last_name}`
  : 'Current User';
```

After:
```typescript
const inspectorName = [userProfile?.first_name, userProfile?.last_name]
  .filter(Boolean)
  .join(' ')
  .trim() || (userProfile ? 'Inspector' : 'Loading...');
```

This ensures:
- A user with only a first name shows that first name
- A user with only a last name shows that last name
- If a profile exists but has no name fields, it shows "Inspector"
- If the profile hasn't loaded yet, it shows "Loading..."

### File: `vite.config.ts`

Bump version to **v2.4.11**.

## Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/InspectionHeader.tsx` | Fix inspector name resolution logic |
| `vite.config.ts` | Version bump to v2.4.11 |

## What Stays the Same

- The inspector field remains disabled/immutable in the UI
- The `inspector_id` database trigger still prevents ID changes
- The `inspectorProfile` is still fetched using the report's `inspector_id` (always the original creator)
- Generated HTML and PDF reports are unaffected (they already resolve the name server-side from `inspector_id`)

