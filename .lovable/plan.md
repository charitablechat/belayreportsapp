

## Phase 3 — Authorization Gaps (Route + Endpoint Guards)

Five findings, six files touched. No DB migrations.

---

### C7 — Per-user-namespaced admin cache keys

**Today:** `cached-admin-status` and `cached-true-super-admin` are global localStorage keys. On a shared device, User B inherits User A's admin badge between sign-in and the first RPC roundtrip — and offline, User B can be permanently treated as admin.

**Fix:** Switch to `cached-admin-status:${userId}` and `cached-true-super-admin:${userId}` everywhere they're read or written.

- New helpers in `src/lib/cached-auth.ts`:
  - `getAdminCacheKey(userId)` / `getTrueSuperAdminCacheKey(userId)` — return the namespaced key.
  - `clearAllAdminCacheKeys()` — sweeps every `cached-admin-status:*` and `cached-true-super-admin:*` key on `SIGNED_OUT`. Used by `invalidateUserCache()`.
  - `clearAdminCacheForUser(userId)` — targeted clear when a single user's role changes.
- `invalidateUserCache()` calls `clearAllAdminCacheKeys()`.
- The auth listener in `cached-auth.ts` adds handling for `USER_UPDATED` and `SIGNED_IN` events: clear cached entries for any user-id that doesn't match the new session's user-id, then re-fetch fresh.
- One-time migration on module load: if the legacy unscoped `cached-admin-status` / `cached-true-super-admin` keys exist, delete them. They're stale by definition.

**Read sites updated** (all switch to namespaced reads, falling back to a fresh RPC if the namespaced key is missing — never the legacy global key):
- `src/lib/cached-auth.ts` — `getAdminStatusWithCache`, `getIsTrueSuperAdmin`.
- `src/hooks/useRequireAdmin.tsx` — both offline-fallback branches.
- `src/hooks/useReportEditPermission.tsx` — both cached-admin reads.
- `src/components/AuthenticatedHeader.tsx` — `is-super-admin-global` query (cached value + placeholder).
- `src/pages/Dashboard.tsx` — `is-super-admin` query (cached value + placeholder).

Each read site needs a `userId` in scope before it can build the key. Sites that don't have one yet (`useRequireAdmin`'s offline fallback) call `getOfflineUserId()` first.

---

### H1 — `<RequireAuth>` route guard for authenticated pages

**New file:** `src/components/auth/RequireAuth.tsx`
- Calls `getUserWithCache()` on mount.
- If a user exists (online session OR cached/synthetic offline session), renders `children`.
- If no user and `navigator.onLine`, redirects to `/`.
- If no user and offline, renders `children` only when `hasCachedSessionForOffline()` returns true; otherwise redirects to `/`.
- Renders `null` (no flash) until the auth check resolves.
- Mirrors the resilience patterns already in `useRequireAdmin` (no flash redirects on transient null).

**`src/App.tsx`:** wrap the following routes with `<RequireAuth>`:
- `/dashboard`, `/profile`, `/onboarding`
- `/inspection/new`, `/inspection/:id`
- `/training/new`, `/training/:id`
- `/daily-assessment/new`, `/daily-assessment/:id`

Public routes left untouched: `/`, `/welcome`, `/install`, `/capabilities`, `/unsubscribe`, `/base64-converter`.

---

### H2 — Admin-gate the logo/admin pages

Three pages currently registered as public routes touch privileged storage or admin tooling. Wrap them in `useRequireAdmin()` (mirrors `AdminLogoManagement.tsx` which already uses it):
- `src/pages/UploadLogos.tsx` — add `const { loading } = useRequireAdmin();` at the top of the component, render `null` while loading.
- `src/pages/UploadLogosToStorage.tsx` — same.
- `src/pages/AdminLogoManagement.tsx` — already gated, no change needed (verified).
- `src/pages/SuperAdminDashboard.tsx` — already gated, no change needed.

Routes left in `App.tsx` with the same paths; the gate lives inside the page so deep-linking still works.

---

### H3 — Authentication gate inside `convert-heic-photos`

**File:** `supabase/functions/convert-heic-photos/index.ts`

Currently uses the service-role client unconditionally. Add a JWT-validated auth check at the top of the `try` block, before any photo iteration:
- Read `Authorization` header; reject with 401 if missing.
- Build a second client with the anon key + the user's `Authorization` header.
- Call `supabase.auth.getUser()`; reject with 401 on null/error.
- Proceed with the existing service-role client for the actual conversion work.

No admin gate — all authenticated users keep full access (per your revised spec). Unauthenticated external requests are blocked.

---

### H7 — Conditional role re-write in `admin-manage-user` update

**File:** `supabase/functions/admin-manage-user/index.ts`, `case 'update'` block (lines 215–240).

Today: any update payload that includes `role` deletes ALL `user_roles` rows for that user, then inserts one. This wipes multi-org role assignments even when the admin only meant to change a name.

Fix:
1. Only run the delete + insert when `role !== undefined` in the *parsed payload* (already the case) AND the value differs from the user's current top-level role.
2. Before deleting: `SELECT role FROM user_roles WHERE user_id = $1 AND organization_id IS NULL` to read the current top-level role.
3. If `currentRole === role`: skip the delete and insert entirely. Log "role unchanged, skipping".
4. If `currentRole !== role`: scope the delete to top-level rows only — `.delete().eq('user_id', userId).is('organization_id', null)` — so per-org role rows survive. Then insert the new top-level role.

This preserves multi-org assignments and avoids destructive churn on no-op updates.

---

### Files touched (summary)

- `src/lib/cached-auth.ts` — namespaced cache helpers, listener updates, legacy migration
- `src/hooks/useRequireAdmin.tsx` — namespaced reads
- `src/hooks/useReportEditPermission.tsx` — namespaced reads
- `src/components/AuthenticatedHeader.tsx` — namespaced reads in admin query
- `src/pages/Dashboard.tsx` — namespaced reads in admin query
- `src/components/auth/RequireAuth.tsx` — **new**
- `src/App.tsx` — wrap authenticated routes
- `src/pages/UploadLogos.tsx` — `useRequireAdmin()`
- `src/pages/UploadLogosToStorage.tsx` — `useRequireAdmin()`
- `supabase/functions/convert-heic-photos/index.ts` — JWT auth gate
- `supabase/functions/admin-manage-user/index.ts` — conditional role rewrite

No DB migrations. No new secrets. No `config.toml` changes.

---

### Risk

- **C7**: Existing sessions will see one extra RPC call after deploy because the legacy unscoped key gets wiped. Acceptable; no UX change beyond a sub-second cache miss.
- **H1**: The route guard renders `null` while resolving, mirroring the `useRequireAdmin` pattern. No flash redirects on cached sessions. Offline users with a cached session pass through unchanged.
- **H2**: `UploadLogos*` pages were effectively unusable for non-admins anyway (RLS rejects writes). The visible change is a redirect instead of a "permission denied" toast.
- **H3**: Existing in-app callers already attach a JWT via `supabase.functions.invoke()`. No client changes needed.
- **H7**: Admins editing a user's name without changing role no longer wipe the user's role rows. This is a strict improvement.

---

### Verification

1. User A (admin) signs out on a shared device → User B (regular) signs in → `/admin` redirects to `/dashboard` immediately, no admin-flash.
2. Offline-only User B with no cached admin entry → `/admin` redirects to `/dashboard`.
3. Direct nav to `/dashboard` while signed out → redirected to `/`.
4. Direct nav to `/inspection/some-id` while signed out → redirected to `/`.
5. Offline user with cached session → `/dashboard`, `/inspection/:id`, `/profile` all load normally.
6. Direct nav to `/upload-logos` as a regular user → redirected to `/dashboard`.
7. `curl -X POST https://…/convert-heic-photos` with no auth header → 401.
8. Same call with a valid user JWT → proceeds normally.
9. Admin updates a user's first name (no role change) → `user_roles` rows untouched (verify via DB query).
10. Admin updates a user's role from `inspector` → `admin` → top-level role row replaced; per-org role rows preserved.

