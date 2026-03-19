

## User Deactivation and Safe Deletion

### Problem
Currently, deleting a user via the Super Admin panel calls `auth.admin.deleteUser()`, which removes them from `auth.users`. This cascades to delete their `profiles` row, which can break foreign key references from `inspections`, `trainings`, and `daily_assessments` (all reference `profiles.id` via `inspector_id`). Reports must always be preserved regardless of what happens to the user account.

### Changes

**1. Database: Add `is_active` column to `profiles`** (migration)
- Add `is_active BOOLEAN NOT NULL DEFAULT true` to the `profiles` table
- This enables deactivation without removing the user from the system

**2. Database: Change FK behavior on report tables** (migration)
- Alter the `inspector_id` foreign keys on `inspections`, `trainings`, and `daily_assessments` to use `ON DELETE SET NULL` instead of the current behavior (which would fail or cascade)
- Also alter `last_modified_by` FKs similarly
- This ensures that even if a user is fully deleted, their reports survive with `inspector_id = NULL`

**3. Edge function: Add `deactivate` and `reactivate` actions** (`admin-manage-user/index.ts`)
- `deactivate`: Sets `profiles.is_active = false` and bans the user via `auth.admin.updateUserById(userId, { ban_duration: '876000h' })` (effectively permanent ban — prevents login)
- `reactivate`: Sets `profiles.is_active = true` and unbans via `auth.admin.updateUserById(userId, { ban_duration: 'none' })`
- Update `delete` action: before deleting, ensure FK constraints won't cascade-delete reports (the migration handles this)
- Update `list` action: include `is_active` status in response

**4. Frontend: Add deactivate/reactivate controls** (`SuperAdminDashboard.tsx`)
- Add a deactivate/reactivate toggle button per user (e.g., `UserX` / `UserCheck` icons)
- Show deactivated users with a visual indicator (dimmed row + "Deactivated" badge)
- Add confirmation dialog for deactivation
- Keep the delete button but add a stronger warning that deletion is permanent and reports will be orphaned

**5. Frontend: Update delete confirmation** (`SuperAdminDashboard.tsx`)
- Enhance the delete dialog to warn that reports will be preserved but will no longer show the inspector's name
- Suggest deactivation as the preferred alternative

### Files Modified
| File | Change |
|------|--------|
| New migration SQL | Add `is_active` to profiles; alter FK constraints to `ON DELETE SET NULL` |
| `supabase/functions/admin-manage-user/index.ts` | Add `deactivate`/`reactivate` actions; update `list` to include `is_active` |
| `src/pages/SuperAdminDashboard.tsx` | Add deactivate/reactivate UI, update delete confirmation warning |

### User Experience
- **Deactivate**: User cannot log in, profile remains, all reports intact with full attribution
- **Reactivate**: Reverses deactivation, user can log in again
- **Delete**: Permanent removal — reports remain but `inspector_id` set to NULL (name lost unless stored as text on the report)

