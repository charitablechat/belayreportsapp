import { test } from '@playwright/test';

/**
 * Defense-in-depth safety guard for auth-gated e2e specs.
 *
 * The auth-gated suite (login-and-dashboard, offline-edit-reconcile,
 * cloud-backup-snapshot-upload, inspection-photo-upload-and-sync,
 * admin-pre-edit-override) writes `[E2E DEVIN] <ts>`-marked rows to the
 * SAME Supabase project as production because no separate e2e project has
 * been provisioned yet. When a spec fails before its post-flight cleanup,
 * those rows leak forward and surface to admin users whose RLS view spans
 * all inspectors.
 *
 * PR #134 introduced a `workflow_dispatch`-only gate on the auth-gated CI
 * job to stop automatic leakage on every push. That gate was reverted by
 * the Lovable / gpt-engineer-app[bot] regeneration commits a few hours
 * later, immediately re-leaking a fresh `[E2E DEVIN]` row into prod.
 *
 * This helper is a SECOND line of defense — it lives inside the spec
 * files themselves, where Lovable's UI-builder regenerations don't touch.
 * Each auth-gated `test.describe(...)` block calls
 * `requireE2EAuthAllowed()` BEFORE its `test.skip(missing-creds, ...)`
 * line. The describe is skipped unless `E2E_AUTH_ALLOWED=true` is
 * explicitly set in the runner environment, which only the manually
 * triggered `e2e-auth` job in `ci.yml` does.
 *
 * Until a separate Supabase project is provisioned and the auth-gated
 * suite is repointed at it, this is how we keep production clean.
 */

const ALLOWED_FLAG = process.env.E2E_AUTH_ALLOWED;

/**
 * Skip the calling describe block unless the runner has been explicitly
 * opted in via `E2E_AUTH_ALLOWED=true`. Call this at the top of every
 * auth-gated `test.describe(...)`, BEFORE any `test.skip(...)` calls
 * that gate on credentials being present (so a missing flag short-
 * circuits the credential check too).
 *
 * Returns `true` if the suite is allowed to run, `false` otherwise. The
 * return value is informational — `test.skip(...)` already aborts the
 * describe block when triggered, so callers don't need to branch on it.
 */
export function requireE2EAuthAllowed(): boolean {
  const allowed = ALLOWED_FLAG === 'true';
  test.skip(
    !allowed,
    'auth-gated e2e specs are skipped unless E2E_AUTH_ALLOWED=true is set ' +
      'in the runner environment. Only the manually triggered `e2e-auth` ' +
      'job in `.github/workflows/ci.yml` sets this flag, to prevent ' +
      "`[E2E DEVIN]`-marked rows from leaking into production Supabase on " +
      'every push. Until a separate e2e Supabase project is provisioned ' +
      '(and `E2E_TEST_*` / `E2E_ADMIN_*` repointed at it), the auth-gated ' +
      'suite is run on demand only.'
  );
  return allowed;
}
