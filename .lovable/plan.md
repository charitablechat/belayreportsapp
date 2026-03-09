

# Enable Delete for User Data Recovery Sheet

## Problem
The `UserDataRecoverySheet` component passes `allowDelete={false}` to both `LocalSnapshotsPanel` and `CloudSnapshotsPanel`, hiding the delete buttons from regular users.

## Fix
Change both `allowDelete={false}` to `allowDelete={true}` in `src/components/UserDataRecoverySheet.tsx` (lines 23 and 26).

That is the only change needed. The delete handlers, confirmation dialogs, and UI buttons already exist within both panel components — they are just gated behind the `allowDelete` prop.

## Files Changed
- `src/components/UserDataRecoverySheet.tsx` — 2 prop values flipped from `false` to `true`

