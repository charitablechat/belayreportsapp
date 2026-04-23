

## PR 4 Status & Remaining Work

### Status of each item

**H3 — Admin gate on `convert-heic-photos`: ❌ NOT DONE**
The function currently authenticates the caller (lines 20–40) but does not check admin status. Any signed-in user can pass arbitrary `table`/`bucket` values and rewrite photo paths across other users' reports.

**H4 — Unify version scheme: ✅ DONE**
- `src/lib/version-calculator.ts` is already reduced to pure parse/format helpers; the 1–9 rollover calculator was removed in an earlier phase (comment confirms this).
- `vite-auto-version.ts` owns the patch via monotonic git commit count.
- `src/lib/attestation.ts` reads `import.meta.env.APP_VERSION` injected by `vite-auto-version.ts` — same source.
- No remaining callers of any rollover logic.

**H7 — Don't wipe all roles on update: ✅ DONE**
`admin-manage-user/index.ts` lines 214–259 already implement the conditional rewrite: reads current top-level role, skips if unchanged, and scopes the delete to `organization_id IS NULL` so per-org role rows are preserved.

---

### Plan to close H3

One file: `supabase/functions/convert-heic-photos/index.ts`.

After the existing `getUser()` check (around line 40), add an admin check using the user-scoped client so RLS context is preserved:

```ts
const { data: isAdmin, error: adminErr } = await userClient.rpc('is_admin_or_above');
if (adminErr || !isAdmin) {
  return new Response(
    JSON.stringify({ error: 'Forbidden: admin privileges required' }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

Why `is_admin_or_above` (not `is_super_admin`): mirrors the pattern used by `admin-manage-user` and matches the project's RBAC memory (`is_admin_or_above` is the canonical admin gate; True Super Admin is read-only/invisible).

### Files touched
- `supabase/functions/convert-heic-photos/index.ts` — insert ~6 lines after the existing auth check.

### Risk
Trivial. No DB migration, no schema change, no client changes. Behavior change: non-admin authenticated users calling the function now receive `403` instead of executing conversions on photos they may not own.

