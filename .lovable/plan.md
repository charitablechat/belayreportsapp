

## Phase 1 — Externally-exploitable criticals

Five edge functions get auth and one secret gets added. ~150 LOC, no client changes, no migrations.

---

### C1 — Webhook-secret auth on three unauthenticated edge functions

For each of `backup-photo-storage`, `generate-backup-pdfs`, and `scheduled-backup-notify`: add a webhook-secret check at the very top of the `try` block, before any other work. Reuses the exact pattern already in `send-push-notification`, `check-overdue-reports`, and `send-notification-email`.

Pattern inserted:
```ts
const webhookSecret = req.headers.get("x-webhook-secret");
const { data: secretRow, error: secretError } = await adminClient
  .from("webhook_config")
  .select("key_value")
  .eq("key_name", "WEBHOOK_SECRET")
  .single();
if (secretError || !secretRow?.key_value) {
  return new Response(JSON.stringify({ error: "Server configuration error" }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
if (!webhookSecret || webhookSecret !== secretRow.key_value) {
  return new Response(JSON.stringify({ error: "Unauthorized" }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```

`verify_jwt = false` stays in `supabase/config.toml` for all three so the existing pg_cron triggers (which call via pg_net and can't attach JWTs) keep working — they already pass `x-webhook-secret` via `internal_get_webhook_secret()`.

---

### C2 — Role allowlist in `admin-manage-user`

Add a runtime allowlist immediately after `await req.json()` parses the payload, gating both `create` and `update` paths:

```ts
const ALLOWED_ROLES = ['admin', 'inspector', 'trainer'] as const;
if (payload.role !== undefined && !ALLOWED_ROLES.includes(payload.role)) {
  return new Response(
    JSON.stringify({ success: false, error: 'Invalid role. Allowed: admin, inspector, trainer' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

This blocks the admin-→-super_admin escalation path because `super_admin` is no longer accepted at the function boundary, regardless of what value the TypeScript-typed payload claims to be.

The destructive `DELETE FROM user_roles WHERE user_id = X` on update (H7) stays put for now — fixed in Phase 3.

---

### C3 — `SITE_URL` runtime secret replaces hardcoded `.lovable.app`

**`admin-manage-user/index.ts:140-144`** — the password-reset redirect:
```ts
const siteUrl = Deno.env.get('SITE_URL')
  || (Deno.env.get('SUPABASE_URL') ?? '').replace('.supabase.co', '.lovable.app');
await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo: siteUrl });
```

**`og-meta/index.ts:37`** — the `spaBaseUrl` constant:
```ts
const spaBaseUrl = Deno.env.get('SITE_URL') || 'https://ropeworks.lovable.app';
```

Setting the `SITE_URL` secret to `https://rwreports.com` before deploy ensures password-reset emails land on the production custom domain. If the secret is unset, both functions fall back to the current behavior so nothing breaks.

---

### Files touched

- `supabase/functions/backup-photo-storage/index.ts` — webhook-secret check
- `supabase/functions/generate-backup-pdfs/index.ts` — webhook-secret check
- `supabase/functions/scheduled-backup-notify/index.ts` — webhook-secret check
- `supabase/functions/admin-manage-user/index.ts` — role allowlist + SITE_URL fallback
- `supabase/functions/og-meta/index.ts` — SITE_URL fallback

No DB migrations. No client changes. No `config.toml` changes.

---

### Action required from you

Add the `SITE_URL` runtime secret in Lovable Cloud settings before this deploys, otherwise password-reset emails will keep going to the `.lovable.app` URL (current behavior). Recommended value: `https://rwreports.com`.

I'll request the secret as part of the implementation step.

---

### Risk

Low. The three webhook-secret additions follow an already-working pattern in 3+ other edge functions. The role allowlist is a defensive 400 — it can only reject calls that should already be rejected. The `SITE_URL` change uses `||` fallback so an unset secret is a no-op.

---

### Verification

1. `curl -X POST` to `backup-photo-storage` / `generate-backup-pdfs` / `scheduled-backup-notify` without `x-webhook-secret` → 401.
2. Same calls with the correct `x-webhook-secret` (pg_cron path) → 200, work proceeds normally.
3. Admin user calls `admin-manage-user` with `{action:'create', role:'super_admin'}` → 400 with allowlist error.
4. Admin user calls `admin-manage-user` with `{action:'update', role:'admin'}` → 200, role updated.
5. After `SITE_URL=https://rwreports.com` is set: create a new user → password-reset email links to `https://rwreports.com/...`.
6. With `SITE_URL` unset: behavior unchanged from today.
7. Existing nightly cron runs (visible in edge-function logs) continue to succeed.

