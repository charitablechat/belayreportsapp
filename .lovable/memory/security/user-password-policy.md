---
name: User Password Policy
description: Server-side password floor (8 chars + alpha-numeric + common-password blocklist) plus client zxcvbn meter blocking score < 2
type: security
---
The application enforces a layered password policy across all account flows.

**Server floor (enforced in `supabase/functions/admin-manage-user/index.ts`):**
1. Minimum 8 characters (trimmed)
2. Must contain at least one letter AND at least one digit
3. Rejected if it appears in the common-password blocklist (`COMMON_PASSWORDS` set in the function)

**Client UX (`src/lib/password-strength.ts` + `src/components/ui/password-strength-meter.tsx`):**
- Uses `@zxcvbn-ts/core` with the common-language dictionary
- Same hard rules as the server, plus a strength score 0–4 shown as a 5-segment meter
- `acceptable` requires score ≥ 2 (Fair) AND all hard rules pass
- Mounted in `Auth.tsx` (sign-in form) and `admin/UserManagementDialog.tsx` (create/edit user)

**Notes:**
- Existing accounts created under the previous 6-char floor are NOT migrated — the new policy only applies on next password change or new-account creation.
- The Supabase auth API itself still accepts 6+ chars; our edge function is the gating layer for admin-created users.
- `zxcvbn-ts` is configured once via `zxcvbnOptions.setOptions` (lazy-init in `password-strength.ts`).
