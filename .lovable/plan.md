

## Audit Status — Remaining Items From The Full Report

Based on prior PR work (PRs 1–7) and current source inspection, here's what's still open vs. closed.

### ✅ Already Fixed (verified)

| Item | Where | Notes |
|---|---|---|
| C1 (3 unauth edge functions) | `backup-photo-storage`, `generate-backup-pdfs`, `scheduled-backup-notify` | All three now check `x-webhook-secret` |
| C2 (role escalation) | `admin-manage-user` line 79–86 | Allowlist `['admin','inspector','trainer']` blocks `super_admin` |
| C3 (hardcoded reset URL) | `admin-manage-user` line 190 | Uses `SITE_URL` secret with fallback |
| C4 (XOR password storage) | `offline-auth.ts` | Refactored to refresh-token model; passwords never stored |
| C5 (placeholder token in real session key) | `offline-auth.ts` line 35 | Uses `SYNTHETIC_SESSION_KEY` slot, not Supabase's key |
| C6 (SW token postMessage) | `cached-auth.ts` + `synthetic-session-guard.ts` | JWT shape validation guard |
| C7 (cached-admin-status leak) | `cached-auth.ts` | Per-user namespaced `getAdminCacheKey(userId)` |
| H1 (no auth on dashboard) | `App.tsx` | All authenticated routes wrapped in `<RequireAuth>` |
| H3 (convert-heic admin gate) | `convert-heic-photos` line 38 | `is_admin_or_above` RPC check |
| H4 (version rollover) | `version-calculator.ts` | Rollover logic deleted; parse/format only |
| H5 (realtime churn) | `InspectionForm.tsx` | Deps `[id]` only; uses ref inside handler |
| H6 (sign-out race) | `cached-auth.ts` `signOutWithAbort` | Cancels refresh + clears caches |
| H7 (multi-org role wipe) | `admin-manage-user` line 264–309 | Scoped to `organization_id IS NULL` only |
| H8 (hardcoded project ref) | `cached-auth.ts`, `Index.tsx`, `main.tsx` | All client paths derive from env (with one harmless fallback literal) |
| H9 (fragile path parsing) | `backup-photo-storage` | Uses `new URL()` |
| H11 (offline sign-out) | `cached-auth.ts` | `signOutWithAbort` clears offline state regardless of online status |
| M1 (hardcoded Kale UUID) | `is_backup_admin()` RPC + `backup_operator` role | Replaced |
| M3 (HEIC convert order) | `convert-heic-photos` | DB update before storage delete |
| M10 (admin delete orphans) | `admin-manage-user` | Soft-delete default; hard delete = super_admin + opt-in |
| M11 (TABLES drift) | `_shared/backup-tables.ts` | Single source of truth |
| M12 (no admin audit log) | `admin-manage-user` `logAdminAction` | Writes to `audit_logs` for every branch |
| M14 (weak password) | `password-strength.ts` + edge fn | 8-char + alphanum + blocklist + zxcvbn UX |
| M15 (`temp-` IDs at DB) | `sw-sync-validators.ts` `assertNoTempIds` | Hard guard at DB boundary |
| L1 (CORS duplication) | `_shared/cors.ts` | 33 functions migrated |
| L3 (no telemetry) | `log-error.ts` | Forwards to `audit_logs` |
| L9 (manual pre-emptive refresh) | `cached-auth.ts` | Removed; relies on `autoRefreshToken: true` |

### ❌ Still Open

| Severity | Item | Where | Fix |
|---|---|---|---|
| 🟠 H2 | `/upload-logos`, `/upload-logos-storage`, `/admin/logos` are public routes | `App.tsx` lines 202–204 | Wrap in `<RequireAuth>` + admin gate |
| 🟠 H10 | 1,029 ESLint errors — 3 `rules-of-hooks` + 1 `no-unsafe-optional-chaining` are real bugs; 42 `exhaustive-deps` are stale-closure risks | repo-wide | Fix the 4 hard errors first; triage exhaustive-deps |
| 🟡 M2 | Lovable preview SW-cleanup ships in production bundle | `index.html` | Tighten hostname check; exclude production |
| 🟡 M4 | IDB v10 upgrade with 50+ stores — no failure telemetry | `offline-storage.ts` | Add `blocked`/`versionchange` listeners with toasts |
| 🟡 M5 | `scheduled-backup-notify` puts `serviceRoleKey` in self-invoked fetch | `scheduled-backup-notify` line 396 | Use `supabase.functions.invoke` or `X-Auth-Token` |
| 🟡 M6 | Storage RLS uses `TO public` instead of `TO authenticated` for UPDATE | photo bucket policies | SQL migration to unify |
| 🟡 M8 | `is_admin_or_above` is global (no org scoping) | RPC | Acceptable today; revisit when per-org admins are needed |
| 🟡 M13 | Per-IP in-memory rate limit on `send-contact-email` etc. | `_shared/rate-limiter.ts` | Deferred per project policy |
| 🟡 M16 | Photo `blob` nullified after upload — retry path may not have it | `offline-storage.ts` | Verify retry downloads from server |
| 🟡 M18 | iOS-only PWA reset notice; Windows PWA has same problem | `Auth.tsx` | Detect both standalone modes |
| 🟡 M19 | `/base64-converter`, `/upload-logos*` routes exposed in production | `App.tsx` | Dev-only env gate or move to admin subapp |
| 🟡 M20 | PWA stale-bundle hard-block coverage audit | `MinVersionEnforcer` | Confirm policy covers security bumps |
| ⚪ L2 | 983 `as any` | repo-wide | Skip — low ROI |
| ⚪ L4 | `initialize-logos` hardcodes wrong-shape storage URLs | `initialize-logos/index.ts` lines 19–20 | Likely dead; verify or fix to `/storage/v1/object/public/` |
| ⚪ L5 | Personal names in business-logic comments | `useReportEditPermission.tsx` | Cosmetic |
| ⚪ L6 | `chart.tsx` `dangerouslySetInnerHTML` without DOMPurify | line 70 | Internal-only data; add comment explaining why no sanitizer needed |
| ⚪ L7 | iframe `sandbox` attr needs comment | `HtmlReportViewer.tsx` | Add comment; no behavior change |
| ⚪ L8 | `pushState` history guard needs documentation comment | `App.tsx` | Comment only |
| ⚪ L10 | `.env` not in `.gitignore` | `.gitignore` | Add `.env` and `.env.*` (only `*.local` covered today) |
| ⚪ L11 | SW `importScripts` cache-busting check | `vite-pwa-config.ts` | Verify on next SW bump |
| ⚪ L12 | `og-meta` 404→redirect may be log-noisy | `og-meta` | Informational |
| ⚪ I4 | No `test` script in `package.json` despite Vitest deps | `package.json` | Add `"test": "vitest"` for CI visibility |
| 🟡 PDF logos | `report-layout.ts`, `generate-inspection-pdf`, `generate-training-pdf` hardcode the project ref in 3 logo URLs | edge functions | Switch to `${SUPABASE_URL}/storage/v1/object/public/pdf-templates/...` |

### Recommended Next Sprint (PR 8 — Polish & Hardening II)

Group the remaining items into a single PR. Roughly half are 1–3 line fixes:

1. **H2 / M19** — wrap `/upload-logos`, `/upload-logos-storage`, `/admin/logos`, `/base64-converter` in `<RequireAuth>` (and `useRequireAdmin` for the logo routes); env-gate `/base64-converter` to dev only.
2. **H10 (hard errors)** — fix the 3 `react-hooks/rules-of-hooks` violations and the 1 `no-unsafe-optional-chaining`. Leave the 983 `no-explicit-any` and most `exhaustive-deps` for opportunistic cleanup.
3. **M2** — tighten the inline SW-unregister script in `index.html` to only fire on `*.lovableproject.com` / `*.lovable.app` preview hosts (not custom domains or `id-preview--`).
4. **M5** — replace the self-invoked `fetch` in `scheduled-backup-notify` with `supabase.functions.invoke` (uses internal auth, no key in headers).
5. **M6** — SQL migration changing `TO public` → `TO authenticated` on photo bucket UPDATE policies.
6. **M18** — broaden the PWA-reset notice in `Auth.tsx` to cover both iOS and Windows standalone modes.
7. **L4 + PDF logos** — replace hardcoded `https://ssgzcgvygnsrqalisshx.supabase.co/...` URLs in `initialize-logos`, `report-layout.ts`, `generate-inspection-pdf`, `generate-training-pdf` with `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/pdf-templates/...`.
8. **L6 / L7 / L8** — code comments only.
9. **L10** — append `.env` and `.env.*` to `.gitignore`.
10. **I4** — add `"test": "vitest"` script to `package.json`.

### Out of Scope (deferred per policy)
- **M13** — backend rate limiting (waiting on centrally-managed primitives)
- **M8** — per-org admin scoping (architectural change, not needed today)
- **L2** — 983-site `as any` cleanup (low ROI churn)
- **M4** — IDB upgrade telemetry (Phase 5 migration safety already covers snapshot rollback)
- **M16, M20** — verification tasks, no code changes pending findings
- **H10 (warnings bucket)** — 42 exhaustive-deps + 19 no-empty + others triaged opportunistically

### Risk
PR 8 is mostly route guards, comments, and one SQL migration. No behavioral changes to sync, auth, or report generation paths. Estimated 1 PR.

