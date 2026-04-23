

## Close out H2: gate `/base64-converter` behind admin

The only remaining gap from the C7/H1/H2 trio. Two small changes:

### 1. `src/pages/Base64Converter.tsx`
Add `useRequireAdmin()` at the top of the component (mirroring `UploadLogos.tsx`):
- Pull `loading` and `isAdmin` from the hook.
- Render `null` (or a minimal "Checking permissions…" state) while `loading` is true.
- Render `null` if `!isAdmin` (the hook already redirects to `/dashboard`).

### 2. `src/App.tsx` route table
Wrap the route in `<RequireAuth>` for defense-in-depth so unauthenticated users don't even mount the component:

```tsx
{ path: "/base64-converter", element: <RequireAuth><Base64Converter /></RequireAuth> },
```

Same treatment for consistency on `/admin`:

```tsx
{ path: "/admin", element: <RequireAuth><SuperAdminDashboard /></RequireAuth> },
```

### Why this is enough
- C7 is already complete — every read/write of the admin cache flows through `getAdminCacheKey(userId)`, so User B on a shared device cannot inherit User A's admin bit.
- H1 is already complete — every authenticated page in the router is wrapped in `<RequireAuth>` (the route-element form of the hook the original note suggested).
- After this change, every admin-or-utility surface (`/upload-logos`, `/upload-logos-storage`, `/admin`, `/admin/logos`, `/base64-converter`, `/onboarding`) is gated by `useRequireAdmin()` AND the route itself sits behind `<RequireAuth>`.

### Files touched
- `src/pages/Base64Converter.tsx` (add hook + loading/redirect guard)
- `src/App.tsx` (wrap `/base64-converter` and `/admin` in `<RequireAuth>`)

Risk: trivial. No DB, no edge functions, no schema changes.

