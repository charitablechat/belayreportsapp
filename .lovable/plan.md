

## Fix User Password Update — Cross-Platform

### Problem
When editing a user and setting a new password, the edge function returns a non-2xx error. The root causes are:

1. **Poor error surfacing**: `supabase.functions.invoke` sets `error` on non-2xx responses, but the actual error message from the function body (`data.error`) is not always read because `throw error` fires first with a generic "Edge Function returned a non-2xx status code" message.
2. **Unreliable HTML `minLength`**: The `minLength={6}` attribute on password inputs is not consistently enforced on Android/iOS mobile browsers, allowing short passwords to be submitted.
3. **Empty password sent as update**: When editing, if the password field has whitespace-only content, it passes the `if (password)` check in the edge function but fails Supabase Auth's validation.

### Changes

#### 1. `src/components/admin/UserManagementDialog.tsx`
- Add explicit password validation before submit: trim and check length >= 6 (only when password is non-empty in edit mode)
- Show inline validation error for password field
- Add a "show/hide password" toggle button for mobile usability

#### 2. `src/pages/SuperAdminDashboard.tsx` — `handleUpdateUser`
- Fix error handling: read `data?.error` from the function response body before falling back to the generic `error` object
- Pattern: `if (error) { const msg = data?.error || error.message; throw new Error(msg); }`
- Apply same fix to `handleCreateUser` and other edge function calls for consistency

#### 3. `supabase/functions/admin-manage-user/index.ts`
- Trim and validate password server-side: if password is provided but less than 6 characters, return a clear 400 error before calling `updateUserById`
- Strip empty/whitespace-only passwords so they don't get sent to the Auth API

### Summary

| File | Change |
|------|--------|
| `UserManagementDialog.tsx` | Client-side password validation + show/hide toggle |
| `SuperAdminDashboard.tsx` | Fix error message extraction from edge function responses |
| `admin-manage-user/index.ts` | Server-side password validation and trimming |

