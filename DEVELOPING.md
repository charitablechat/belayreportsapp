# Developing

Operational notes for maintaining `ropeworks-5b9736d7`. The user-facing
application docs live in `README.md`; this file covers infrastructure
that contributors and repo admins need to know about.

## CI overview

Defined in `.github/workflows/ci.yml`. Runs on:

- every `pull_request` (cancels previous runs on the same PR)
- every `push` to `main` (does **not** cancel previous runs — see below)

Jobs currently defined on `main`:

| Job | Purpose |
|---|---|
| `tsc --noEmit` | TypeScript type-checking, no emit |
| `lint:any-budget gate` | Enforces the per-file `any` budget (see `scripts/lint-any-budget.mjs` and `.eslint-any-budget`) |
| `vitest` | Unit + integration tests in jsdom |
| `vite build (incl. db-version parity check)` | Production build; vite plugin fails if `public/db-config.js` and `src/lib/offline-storage.ts` disagree on the IDB version number |

A `playwright e2e (smoke + auth + offline-edit-reconcile)` job is queued
to land via PR #23. Once that PR merges and the job appears in a real
CI run, it should be added to the required-status-checks list below.

A second workflow, `.github/workflows/main-broken-alert.yml`, listens
for the CI workflow's completion via `workflow_run` and opens a labelled
GitHub issue (`ci-main-broken`) whenever main CI fails. This makes
breakage on main loud and persistent rather than only surfacing as a red
status badge that can be missed for hours.

### Concurrency

The CI workflow uses conditional `cancel-in-progress`:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Pull-request runs cancel each other on rapid pushes (saves CI minutes).
Main-push runs do not cancel each other — if two commits land
back-to-back we want each one's CI to complete so the green/red signal
on each commit is preserved. Cancelling masks a transient breaking
commit as "cancelled" (neither pass nor fail), which the alert workflow
cannot detect.

## Required GitHub Actions secrets

Set these at
<https://github.com/charitablechat/ropeworks-5b9736d7/settings/secrets/actions>.

| Secret | Purpose | Without it |
|---|---|---|
| `E2E_TEST_EMAIL` | Real Supabase user email for the auth-gated Playwright specs | The login + offline-edit-reconcile tests `test.skip` at runtime; the smoke scope still runs |
| `E2E_TEST_PASSWORD` | Real Supabase user password for the auth-gated Playwright specs | Same as above |

The Devin secret store is separate from GitHub Actions secrets — values
saved at `user` scope in Devin do not propagate to CI. The two stores
must be kept in sync manually.

## Branch protection setup

The `main` branch should be configured with branch protection so direct
pushes that break CI cannot land at all. This is **repo-level
configuration** (Settings → Branches → Branch protection rules) and
cannot be expressed in a workflow file.

Recommended rules for `main`:

- **Require a pull request before merging.** Disables direct pushes from
  any non-admin contributor (including bots like `gpt-engineer-app`,
  i.e. Lovable). All changes flow through a PR with CI as a gate.
- **Require status checks to pass before merging.** Add every job
  defined in `.github/workflows/ci.yml` that has actually reported a
  status on at least one prior PR/push (currently `tsc --noEmit`,
  `vitest`, `lint:any-budget gate`, and `vite build (incl. db-version
  parity check)`; once PR #23 merges, also `playwright e2e (smoke +
  auth + offline-edit-reconcile)`). 

  > Important: GitHub treats a required status check that has never
  > reported as perpetually "pending" and blocks every PR from
  > merging. Only add a check name to this list **after** you've seen
  > it appear in at least one CI run on the repo.
- **Require branches to be up to date before merging.** Forces a rebase
  if main has moved since the PR was opened, so the merge commit's CI
  reflects the actual main + PR diff.
- **Do not allow bypassing the above settings.** Even repo admins
  should be subject to the gates so a quick "I'll just merge this
  red" doesn't slip in.
- **Restrict force pushes** and **restrict deletions** of `main`.

If Lovable is configured to push directly to `main`, reconfigure it
(via the Lovable project settings) to push to a `lovable/*` branch and
open a PR. The PR will then go through the same CI gates as a human
contributor's PR.

### Why this matters

Without branch protection, a Lovable regeneration that breaks the build
(e.g. `06763d6a` "Removed Avg Completion Time card", which left
unbalanced JSX in `SuperAdminDashboard.tsx`) lands on main immediately.
CI runs but only post-hoc — every downstream PR's build is broken until
someone manually reverts. The `main-broken-alert` workflow makes the
post-hoc detection loud, but only branch protection prevents the broken
commit from landing in the first place.

## Local development

```bash
bun install
bun run dev          # http://localhost:8080 (Vite dev server)
bun run build        # production build to dist/
bun run test         # vitest
bun run lint         # ESLint (informational; not gated)
bun run lint:any-budget   # the gated `any` budget check
bunx tsc --noEmit    # TypeScript type-check
bunx playwright test # all e2e scopes (auth-gated specs need .env values)
```

The Playwright config (`playwright.config.ts`) auto-spawns
`bun run build && bun run preview --port 4173 --strictPort` when running
locally, so a clean checkout works end-to-end with no extra setup.

## Pull request etiquette

- Smaller PRs are preferred. Multi-PR campaigns are normal for
  cross-cutting changes — see PRs #15 through #22 for an example of a
  scope-C root-cause fix split into 6 focused PRs.
- The `any` budget (`.eslint-any-budget`) is a ratchet. Drift is
  allowed but each PR should either match the prior budget or
  explicitly bump it (with a comment explaining the tradeoff).
- The Playwright scope-C spec (`offline-edit-reconcile.spec.ts`) is the
  canonical regression test for the offline-edit-reconcile path. Don't
  re-quarantine it without a corresponding production-hardening PR.

## Key infrastructure files

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Main CI pipeline |
| `.github/workflows/main-broken-alert.yml` | Opens an issue when main CI fails |
| `playwright.config.ts` | E2E config, including the auto-build webServer |
| `vite.config.ts` | Build config + the `vite-db-version-check` plugin |
| `scripts/lint-any-budget.mjs` | The `any` budget enforcement script |
| `.eslint-any-budget` | Per-file budget JSON consumed by the script |
| `tests/e2e/_fixtures/` | Reusable Playwright fixtures (auth, Supabase REST helpers) |
