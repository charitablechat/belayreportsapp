

## Phase 5 — High-leverage Medium Fixes

Five findings. One DB migration, six edge-function edits, one new shared module, one client-side cleanup.

---

### M1 — Replace hardcoded `BACKUP_ADMIN_ID` with role-based check

**Today:** Four files (`export-full-backup`, `restore-full-backup`, `sync-offsite-backup`, `SuperAdminDashboard.tsx`) hardcode `759e973e-2484-4db3-862a-0cb2ec6d6ea3`. The existing `public.is_backup_admin()` RPC also hardcodes the same UUID. If Kale's UUID ever changes or a second backup operator is needed, four files plus the function need surgery.

**Fix:**

DB migration:
1. Add `'backup_operator'` to the `app_role` enum (alongside existing `super_admin`, `admin`, `inspector`, `trainer`).
2. `INSERT INTO public.user_roles (user_id, role, organization_id) VALUES ('759e973e-2484-4db3-862a-0cb2ec6d6ea3', 'backup_operator', NULL) ON CONFLICT DO NOTHING;`
3. Replace `is_backup_admin()` body with `SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'backup_operator')`. Keeps the same name + signature so existing RLS policies on `backup_history` and `storage.objects` keep working.

Edge functions (`export-full-backup`, `restore-full-backup`, `sync-offsite-backup`):
- Replace `if (userId !== BACKUP_ADMIN_ID)` with an RPC call: `const { data: isBackupAdmin } = await userClient.rpc('is_backup_admin'); if (!isBackupAdmin) return 403;`
- Delete the hardcoded constant.

Frontend (`SuperAdminDashboard.tsx`):
- Replace `currentUserId === BACKUP_ADMIN_ID` with a one-shot `supabase.rpc('is_backup_admin')` call cached in state. Result drives `<AdminTabsSection showBackupTab={...} />`.
- Delete the constant.

The hardcoded UUID in `migrate-orphaned-photos/index.ts` is unrelated (it's a target inspector_id for legacy photo re-parenting, not an auth check) — left alone.

---

### M3 — `convert-heic-photos`: update DB before deleting old storage object

**Today** (lines ~120–145): the function uploads the new `.jpg` path, updates the DB row, *then* removes the old HEIC. If the storage delete fails after the DB update, you get an orphan blob — annoying but not corrupting. But if the DB update fails *after* the upload, the old row still points at the HEIC; if a separate retry then deletes the HEIC, the row is broken.

**Fix:** Reorder so the DB update and the new-path upload happen first (already the case), then wrap the delete in its own try/catch. If delete fails, log and continue — never propagate to the caller.

```ts
try {
  await supabase.storage.from(bucket).remove([photo.photo_url]);
} catch (delErr) {
  console.warn(`[convert-heic-photos] orphan blob left at ${photo.photo_url}: ${delErr}`);
}
```

The current code already swallows the delete error implicitly (no `await` check), but the explicit try/catch + log makes the contract obvious and future-proofs against await behaviour changes.

---

### M10 — `admin-manage-user`: `delete` becomes deactivate by default; hard-delete is opt-in

**Today:** `case 'delete'` calls `supabaseAdmin.auth.admin.deleteUser(userId)` directly, which removes the auth user and cascades. Irreversible.

**Discovery:** the function already has working `deactivate` and `reactivate` actions that ban the user (876,000h) + flip `profiles.is_active`. So the safer path already exists — we just need to redirect `delete` to it.

**Fix in `case 'delete'`:**

1. If `payload.hard !== true` (default): execute the existing deactivate logic (ban + `is_active=false`). Return `{ success: true, deactivated: true }`. Add `deactivated` flag to make the change visible to the client.
2. If `payload.hard === true`: require an additional super-admin check. The current guard is `is_admin_or_above` (Admin OR Super Admin); harden the hard-delete branch to require *true* `is_super_admin()` via a fresh RPC call before falling through to `auth.admin.deleteUser`.
3. Audit log line: `console.log(\`User \${userId} \${hard ? 'hard-deleted' : 'deactivated'} by \${user.id}\`);`

No client changes required for the soft path — the existing UI's "Delete user" button keeps working but now safely deactivates. Hard-delete is exposed only by callers that explicitly pass `hard: true`.

---

### M11 — Extract `TABLES = [...]` into `_shared/backup-tables.ts`

**Today:** `export-full-backup`, `restore-full-backup`, and `scheduled-backup-notify` each define the same ~45-row array, twice diverged (e.g. `restore-full-backup`'s `UPSERT_ORDER` is the same set in dependency order). Adding a new table to the schema today is a 3-file edit and easy to forget.

**Fix:**

New file `supabase/functions/_shared/backup-tables.ts`:
```ts
// Single source of truth for which tables get backed up / restored.
// Order matters for restore: parents before children.
export const BACKUP_TABLES = [
  'organizations',
  'profiles',
  'organization_members',
  'user_roles',
  'admin_settings',
  'app_announcements',
  'notification_preferences',
  'push_subscriptions',
  'form_sections',
  'form_fields',
  'form_field_options',
  'form_translations',
  'form_versions',
  'global_field_history',
  'user_field_history',
  'onboarding_resources',
  'onboarding_progress',
  'inspections',
  'inspection_systems',
  'inspection_equipment',
  'inspection_standards',
  'inspection_photos',
  'inspection_ziplines',
  'inspection_summary',
  'inspection_reports',
  'trainings',
  'training_systems',
  'training_equipment',
  'training_photos',
  'training_operating_systems',
  'training_delivery_approaches',
  'training_verifiable_items',
  'training_immediate_attention',
  'training_systems_in_place',
  'training_summary',
  'training_reports',
  'daily_assessments',
  'daily_assessment_beginning_of_day',
  'daily_assessment_end_of_day',
  'daily_assessment_environment_checks',
  'daily_assessment_equipment_checks',
  'daily_assessment_operating_systems',
  'daily_assessment_structure_checks',
  'daily_assessment_photos',
  'audit_logs',
] as const;

export type BackupTable = typeof BACKUP_TABLES[number];
```

The order above (parents first) matches `restore-full-backup`'s current `UPSERT_ORDER` and is also valid for export (order doesn't matter for export). All three functions import `BACKUP_TABLES` and replace their local arrays. Local-only constants (`EXCLUDE_COLUMNS`, `REPORT_CONFIG`) stay in `scheduled-backup-notify`.

---

### M13 — Postgres-backed rate limiter for `send-contact-email`

**Today:** `_shared/rate-limiter.ts` uses a `Map` that resets on every cold start. A bot hitting the contact form across cold starts can blow past the 3-per-hour cap.

**Per project policy (see `<important-info>`)**, backend rate limiting is a known infrastructure gap that the platform plans to address centrally. Implementing an ad-hoc Postgres counter here would set a precedent we'd then have to maintain and migrate later.

**Fix:** keep the existing in-memory limiter for `send-contact-email` *and* tighten the existing layered defenses already in the function:
- The honeypot field (`website`) catches non-form-rendering bots → silently 200.
- Strict input validation (subject allowlist, length caps, email regex) kills malformed payloads.
- The Make.com webhook itself can be configured with its own rate limit (out-of-band of this codebase).

We will leave M13 as **deferred** with a code comment in `_shared/rate-limiter.ts` explaining the cold-start limitation and pointing at the platform-level work. No DB table created. If you want an ad-hoc Postgres counter despite the policy, say so and I'll add a `rate_limit_buckets` table in a follow-up — but the default is to defer.

---

### Files touched (summary)

**Migration** (`supabase/migrations/<timestamp>_phase5_backup_operator_role.sql`):
- Add `backup_operator` to `app_role` enum.
- Insert `(kale_uuid, 'backup_operator', NULL)` into `user_roles`.
- Replace `is_backup_admin()` body with role-based `EXISTS` check.

**Edge functions:**
- `supabase/functions/_shared/backup-tables.ts` — **new**
- `supabase/functions/_shared/rate-limiter.ts` — comment documenting M13 deferral
- `supabase/functions/export-full-backup/index.ts` — RPC check + import shared TABLES
- `supabase/functions/restore-full-backup/index.ts` — RPC check + import shared TABLES (as UPSERT_ORDER)
- `supabase/functions/sync-offsite-backup/index.ts` — RPC check, drop hardcoded UUID
- `supabase/functions/scheduled-backup-notify/index.ts` — import shared TABLES
- `supabase/functions/convert-heic-photos/index.ts` — explicit try/catch around storage delete (M3)
- `supabase/functions/admin-manage-user/index.ts` — `delete` action becomes deactivate-by-default; `hard:true` opt-in (M10)

**Frontend:**
- `src/pages/SuperAdminDashboard.tsx` — replace `BACKUP_ADMIN_ID` with `is_backup_admin` RPC

---

### Risk

- **M1**: Low. Same RPC name, same RLS contract; only the implementation swaps from hardcoded UUID to role lookup. Migration grants the role to Kale before the function body changes, so there's no window where backup access breaks.
- **M3**: Very low. Wrapping an already-fire-and-forget delete in try/catch + log.
- **M10**: Medium UX change — admin clicks "Delete user" and gets a deactivation. Reversible via the existing `reactivate` action. The Admin user-management UI's labels may want to follow up (button copy → "Deactivate"), but functionally nothing breaks.
- **M11**: Low. Pure refactor; behavior identical.
- **M13**: No change. Documented deferral per project policy.

---

### Verification

1. Migration applied → `SELECT * FROM user_roles WHERE role = 'backup_operator';` returns Kale's row.
2. `SELECT public.is_backup_admin();` returns `true` for Kale, `false` for any other authed user.
3. `curl` `export-full-backup` as Kale → 200; as a different admin → 403 with "Backup access restricted".
4. `SuperAdminDashboard` for Kale → Backup tab visible; for any other admin → tab hidden.
5. `admin-manage-user` `{action:'delete', userId:X}` → user is deactivated (banned + `is_active=false`); response includes `deactivated: true`. User can no longer sign in. `reactivate` restores them.
6. `admin-manage-user` `{action:'delete', userId:X, hard:true}` from a non-super-admin → 403. From a super-admin → user is auth-deleted.
7. `convert-heic-photos` with a forced storage-delete failure → DB still updated to `.jpg`, warning logged, function returns 200.
8. Add a fake table to `BACKUP_TABLES` only → all three backup-related functions pick it up on next deploy. Removing it from one place is impossible.
9. Contact form: existing rate-limit behavior unchanged. Honeypot + validation tests still pass.

