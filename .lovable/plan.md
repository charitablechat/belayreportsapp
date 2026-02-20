

# Fix Data Recovery Sheet Mobile Layout

## Problem
The Data Recovery panel uses a wide HTML `Table` with 7 columns that doesn't fit on mobile screens. The table overflows, hiding the "Restore" button and cutting off text. The bottom sheet's `ScrollArea` only scrolls vertically, not horizontally.

## Solution
Replace the table layout with a mobile-friendly **stacked card layout** inside the `LocalSnapshotsPanel` when rendered in the user-facing sheet. Each snapshot becomes a vertical card showing all fields with proper text wrapping and clearly visible action buttons.

## Changes

### 1. Modify `LocalSnapshotsPanel` in `src/components/admin/DataRecoveryTool.tsx`
- Replace the `<Table>` with a responsive layout:
  - On mobile (`md:hidden`): render each snapshot as a stacked card with labeled rows (Type, Organization, Device, Sync status, Last Saved, Size) and full-width action buttons at the bottom
  - On desktop (`hidden md:block`): keep the existing table unchanged for the admin view
- Ensure text wrapping with `break-words` and `min-w-0` on all text containers
- Make the Restore button full-width and prominent on mobile cards

### 2. Adjust `UserDataRecoverySheet.tsx`
- Reduce horizontal padding on mobile (`px-3 sm:px-6`) so cards use more screen width
- Adjust the `ScrollArea` height calculation to account for the header properly

## Files Modified
| File | Change |
|------|--------|
| `src/components/admin/DataRecoveryTool.tsx` | Add responsive card layout alongside existing table |
| `src/components/UserDataRecoverySheet.tsx` | Tighten mobile padding |

