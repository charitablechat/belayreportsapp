

## Send Password Reset Email on Admin User Creation

### Summary
After the admin creates a new user, automatically send a password reset email so the new user can set their own password. This uses the built-in authentication password reset flow — no custom email infrastructure needed.

### How It Works

1. **In the Edge Function** (`admin-manage-user/index.ts`): After successfully creating the user in the `create` action, call `supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email })` to generate a password reset link, then use the Supabase Auth `resetPasswordForEmail` API to send the reset email automatically.

2. **Simpler approach**: Use `supabaseAdmin.auth.resetPasswordForEmail(email)` right after user creation. This sends the standard password reset email with a link to set a new password. No custom templates or email infrastructure required — it uses the built-in auth email system.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/admin-manage-user/index.ts` | In the `create` case, after successful user creation and role assignment, call `resetPasswordForEmail` using the admin client to send a password reset email to the new user |

### Technical Detail

In `admin-manage-user/index.ts`, after the user is created (around line 100, after role assignment):

```typescript
// Send password reset email so the new user can set their own password
const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
await supabaseAdmin.auth.resetPasswordForEmail(email, {
  redirectTo: projectUrl.replace('.supabase.co', '.lovable.app'),
});
console.log(`Password reset email sent to: ${email}`);
```

The new user will receive an email with a link to set their password. The admin-set password acts as a temporary credential — the user is immediately prompted to choose their own.

### User Experience
1. Admin creates user with a temporary password
2. New user receives a "Reset your password" email automatically
3. User clicks the link and sets their own password
4. User can now log in with their chosen password

