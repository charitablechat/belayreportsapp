# Open Sign-Up for Trial Users

Right now the sign-in screen has no way to create an account — it ends with "Contact your administrator if you need an account," and accounts can only be made by an admin. This opens self sign-up so a potential client can create an account and try the app as an inspector/trainer.

## What changes for visitors

- The sign-in card gets a "Create account" option alongside "Sign in".
- Sign-up asks for first name, last name, email, and password (6+ characters, same rule as today).
- After signing up they land in the app immediately — no email confirmation step.
- A "Continue with Google" button is added, usable for both signing up and signing in.
- The "Contact your administrator if you need an account" line is replaced with a short "New here? Create a free account" prompt.

## What new accounts can do

- Full inspector/trainer access: create and manage inspections, trainings, and daily assessments — exactly what a regular user can do today.
- No admin capability. Admin screens and admin-only actions stay closed; admin access still comes only from an admin granting it.

## What does not change

- Existing sign-in, offline sign-in, guest mode, password reset, and the "continue offline" options all behave as they do now.
- Admin user creation from the admin panel stays as-is.
- No change to report data, sync, or offline behavior.

## Technical notes

- `src/components/Auth.tsx`: add a `mode` state (`signin` | `signup` | `forgot`); sign-up calls `supabase.auth.signUp` with `emailRedirectTo: window.location.origin` and `options.data = { first_name, last_name }` so the existing `handle_new_user` trigger populates `profiles`. Reuse existing error mapping, `PasswordStrengthMeter`, and the 6-character minimum.
- Google: add a "Continue with Google" button wired to the Lovable Cloud auth helper with `redirect_uri: window.location.origin` (not `/dashboard`), and call the Configure Social Login tool in the same change so the provider is actually enabled.
- Auth settings: enable auto-confirm email (`configure_auth` with `auto_confirm_email: true`, `disable_signup: false`, anonymous users left off) so sign-up returns a live session.
- Roles: no `user_roles` row is created for self-signups. Verified that `is_admin_or_above` / `is_super_admin` gate all admin surfaces, so a role-less account is a normal user by default — no new migration needed.
- New signups route to the existing post-signup destination (`/onboarding` if incomplete, otherwise `/dashboard`), matching current behavior for a fresh profile.

## Worth deciding later (not in this change)

Open sign-up means anyone can create an account, so the user list will collect trial and throwaway accounts. If that becomes noisy, a follow-up could add a "trial" flag with a time limit or an admin cleanup view.
