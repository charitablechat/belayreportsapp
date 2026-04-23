

## PR 6 Status & Remaining Work

### Status of each item

| Item | Status | Evidence |
|---|---|---|
| **M1** — `backup_operator` role replaces hardcoded UUID | ✅ Done | `is_backup_admin()` RPC + `backup_operator` enum value; used in `export-full-backup`, `restore-full-backup`, `sync-offsite-backup` |
| **M3** — Update DB row before deleting old HEIC blob | ✅ Done | `convert-heic-photos/index.ts` lines 142–161: DB `update` runs first, old blob removal is best-effort with try/catch and warning log |
| **M10** — Deactivate by default; hard delete = super_admin + opt-in | ✅ Done | `admin-manage-user` `delete` action: default = ban + `is_active=false`; `hard:true` requires `is_super_admin()` RPC |
| **M11** — Shared `_shared/backup-tables.ts` | ✅ Done | File exists; `export-full-backup`, `restore-full-backup`, `scheduled-backup-notify` all import `BACKUP_TABLES` |
| **M12** — Insert into `audit_logs` for every admin action | ❌ Not done | `admin-manage-user` only `console.log`s actions. `create_audit_log()` RPC and triggers cover row mutations on `user_roles`, `inspections`, etc., but admin-level actions (deactivate, reactivate, password reset, hard delete, grant_admin/revoke_admin) have no explicit audit-log writes from the function itself |
| **M13** — DB-backed rate limiting | 🚫 Deferred (policy) | Project policy explicitly defers backend rate limiting until centrally-managed primitives exist. In-memory limiter in `_shared/rate-limiter.ts` is annotated with the deferral note. Leave as-is |
| **M14** — Password strength beyond 6 chars | ❌ Not done | `admin-manage-user` still enforces only `password.length < 6`; no `zxcvbn` or blocklist |
| **M15** — Reject `temp-` IDs at DB mutation boundary | 🟡 Partial | `atomic-sync-manager.ts` *transforms* `temp-` → UUID before insert (defensive), but there is no hard `throw` guard at the DB call site. If a future caller skipped the transform, a `temp-` could still reach Postgres |

---

### Plan to close M12, M14, M15

#### M12 — Audit-log every admin action

Edit **`supabase/functions/admin-manage-user/index.ts`**. Add a small helper near the top of the handler (after `supabaseAdmin` is built) that uses the service-role client to insert into `audit_logs` via the existing `create_audit_log` RPC:

```ts
async function logAdminAction(
  actionType: string,
  targetUserId: string,
  oldValues: any,
  newValues: any,
  metadata: Record<string, unknown> = {}
) {
  try {
    await supabaseAdmin.rpc('create_audit_log', {
      p_user_id: user.id,                  // actor
      p_action_type: `admin.${actionType}`, // e.g. admin.deactivate
      p_table_name: 'auth.users',
      p_record_id: targetUserId,
      p_old_values: oldValues,
      p_new_values: newValues,
      p_metadata: { ...metadata, actor_email: user.email },
    });
  } catch (e) {
    console.warn('[admin-manage-user] audit log insert failed:', e);
  }
}
```

Call it at the end of each successful branch:
- `create` → `logAdminAction('create_user', newUser.user.id, null, { email, role }, { organizationId })`
- `update` → `logAdminAction('update_user', userId, null, { email, role, passwordChanged: !!password }, {})`
- `delete` (soft) → `logAdminAction('deactivate_user', userId, { is_active: true }, { is_active: false }, { reason: 'soft_delete' })`
- `delete` (hard) → `logAdminAction('hard_delete_user', userId, null, null, {})`
- `deactivate` / `reactivate` → analogous
- `grant_admin` / `revoke_admin` → already covered by `fn_audit_role_change` trigger on `user_roles`, but add an explicit `admin.grant_admin` / `admin.revoke_admin` row for actor clarity

No schema change required — `audit_logs` table and `create_audit_log` RPC already exist.

#### M14 — Stronger password validation

1. Add **`zxcvbn-ts`** as a client dependency (lightweight, ESM, no Node fs needed). Used in `Auth.tsx` and `UserManagementDialog.tsx` to surface a strength meter and block scores < 2.

2. In **`supabase/functions/admin-manage-user/index.ts`**, replace the `password.length < 6` check (in both `create` and `update` branches) with:
   ```ts
   const COMMON_PASSWORDS = new Set([
     'password','password1','password123','123456','123456789','qwerty',
     'qwerty123','abc123','letmein','welcome','admin','admin123',
     'iloveyou','monkey','football','dragon','baseball','master',
     'sunshine','princess','solo','starwars','ropeworks','ropeworks123',
   ]);
   const pw = (rawPassword || '').trim();
   if (pw.length < 8) return reject('Password must be at least 8 characters');
   if (COMMON_PASSWORDS.has(pw.toLowerCase())) return reject('Password is too common');
   if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return reject('Password must contain at least one letter and one number');
   ```
   Server-side blocklist + composition check is the floor; `zxcvbn` runs client-side for UX feedback.

3. Update **`mem://security/user-password-policy`** to reflect the new floor (8 chars + composition + blocklist).

#### M15 — Hard guard against `temp-` IDs at DB boundary

Add a single shared validator in **`src/lib/sw-sync-validators.ts`** (already exists for sync guards):

```ts
export function assertNoTempIds(record: { id?: string }, context: string): void {
  if (record?.id && typeof record.id === 'string' && record.id.startsWith('temp-')) {
    throw new Error(
      `[sync-guard] Refusing DB mutation: temp-prefixed id "${record.id}" reached ${context}. ` +
      `This indicates a missing temp→UUID transform upstream.`
    );
  }
}
```

Call it in **`src/lib/atomic-sync-manager.ts`** immediately before each `supabase.from(...).upsert(...)` / `.insert(...)` call for inspections, trainings, daily assessments, and their child rows. The existing transforms still run — this is a fail-loud safety net for regressions.

Add a unit test in `src/lib/sw-sync-guards.test.ts` (already exists) covering the throw.

---

### Files touched
- `supabase/functions/admin-manage-user/index.ts` — audit log helper + calls (M12); stronger password validation (M14)
- `src/components/admin/UserManagementDialog.tsx` — client-side password strength UX (M14)
- `src/components/Auth.tsx` — same (M14)
- `package.json` — add `@zxcvbn-ts/core` + `@zxcvbn-ts/language-common` (M14)
- `src/lib/sw-sync-validators.ts` — `assertNoTempIds` helper (M15)
- `src/lib/atomic-sync-manager.ts` — call `assertNoTempIds` before each parent/child upsert (M15)
- `src/lib/sw-sync-guards.test.ts` — test coverage (M15)
- `mem://security/user-password-policy` — updated rule

### Out of scope (explicitly not changing)
- **M1, M3, M10, M11** — already implemented and verified
- **M13** — backend rate limiting is deferred per project policy; the existing in-memory limiter stays
- No DB migrations, no schema changes, no edge function additions

### Risk
Low. M12 is additive (audit rows only). M14 raises the password floor — admins creating users will need to pick stronger passwords; existing accounts are unaffected. M15 is a safety net behind an already-working transform.

