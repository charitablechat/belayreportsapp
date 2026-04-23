

## Update `SITE_URL` Secret to Custom Domain

Set the `SITE_URL` runtime secret to `https://rwreports.com` so password-reset emails (from `admin-manage-user`) and OG redirects (from `og-meta`) point at the canonical custom domain instead of the `ropeworks.lovable.app` fallback.

### Change

- **Secret:** `SITE_URL`
- **Value:** `https://rwreports.com`
- **Scope:** runtime (Edge Functions)

### Consumers (already wired in earlier phases)

- `supabase/functions/admin-manage-user/index.ts` — password-reset `redirectTo` for newly created users.
- `supabase/functions/og-meta/index.ts` — SPA redirect target after social-card scrape.

Both already read `Deno.env.get("SITE_URL")` with a `ropeworks.lovable.app` fallback, so the change is configuration-only — no code edits, no migration, no redeploy needed.

### Verification

1. Create a new user via Admin → user management → password-reset email link starts with `https://rwreports.com/...`.
2. Visit a share URL through `og-meta` → meta-refresh redirect goes to `https://rwreports.com/dashboard`.

### Risk

Very low. Both `www.rwreports.com` and `rwreports.com` are configured custom domains for this project, and Supabase Auth's redirect allowlist already accepts them via the existing custom-domain setup. If for any reason `rwreports.com` becomes unreachable, the fallback in code keeps the system functional.

