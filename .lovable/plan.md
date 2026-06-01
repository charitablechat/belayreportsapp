## Simpler Version Numbers (4.8.0 → 4.8.1 → … → 4.9.9 → 5.0.0)

### First, the screenshot
All three lines in your dropdown — current, installed, deployed — read `v4.7.743127`. They match. There is no discrepancy between the build that went out and the build you updated to. The only real problem is the `743127` is ugly and hard to read. That gets fixed below.

### Why it looks like that today
`vite-auto-version.ts` auto-sets the patch number to the **total git commit count** (currently 743,127 because the count includes Lovable's internal commits). The base `4.7` comes from `version.json`. The plugin was built that way to guarantee no two builds ever share a version — which the stale-build banner and the "minimum required version" enforcement depend on.

### The change
Switch to a fully manual version, exactly as you described:

- `version.json` becomes the single source of truth and holds the full `MAJOR.MINOR.PATCH` (e.g. `"4.8.0"`).
- `vite-auto-version.ts` stops calling `git rev-list --count` and just reads the file verbatim.
- A small helper script `scripts/bump-version.mjs` increments the version with these rules:
  - `bump patch` → `4.8.0` → `4.8.1` … → `4.8.9` → `4.9.0`
  - `bump patch` at `4.9.9` → `5.0.0`
  - `bump minor` / `bump major` available if you ever want to jump intentionally
- The short git commit hash is **kept internally** as `BUILD_COMMIT` (used by Sentry release tags, attestation audit rows, and the diagnostics sheet as a tiebreaker), but it is **not shown** in the profile dropdown. You asked for "everywhere," and the hash is invisible to the user — the visible string everywhere will simply be `v4.8.0`.

### Starting version
Per your instruction, the first deploy after this change publishes as **`4.8.0`**. From there every deploy bumps the patch by one until `4.9.9`, then rolls to `5.0.0`.

### Who bumps it, and when
This is the one tradeoff to be explicit about: because the version is no longer auto-derived, **something has to bump `version.json` before each deploy or two different builds will share the same number** (which silently breaks the "new version available" banner and min-version enforcement).

Two options, pick one in the build phase:

1. **You/Brenda bump it manually** by running `npm run bump:patch` (or editing `version.json`) before asking me to deploy. Simplest, zero magic, but relies on remembering.
2. **Auto-bump on deploy**: a tiny pre-build step automatically increments the patch by 1 every time a production build runs (and rolls 9→next minor, 9.9→next major). You never touch it; the number simply ticks up one per deploy. Recommended.

If you don't pick, I'll default to **option 2 (auto-bump)** because it matches your "I just want it to go 4.8.0, 4.8.1, 4.8.2…" framing and removes the forgotten-bump failure mode.

### Where the new short number appears
Everywhere user-visible:
- Profile dropdown (current / installed / deployed lines)
- Update-available banner and "Update Now" celebration toast
- Minimum-version enforcement screen
- Sync Diagnostics sheet
- Recovery & Sync Health page
- `/version.json` served to clients (so the stale-build check compares short numbers)
- Sentry release tag
- Attestation `app_version` column written on new completions

Existing audit/attestation rows already stamped with `4.7.743127` are **left exactly as-is** — historical records stay historically accurate. Only new records use the new scheme.

### Comparator
`isVersionNewer()` already does numeric SemVer compare (`4.7.9 < 4.8.1 < 5.0.0`), so the existing stale-build detector and min-version policy keep working without changes. The dev-mode self-tests in `version-check.ts` will be extended with cases for the rollover (`4.9.9 → 5.0.0`).

### What is NOT changing
- No sync engine, saver, atomic-sync, Supabase client, edge functions, migrations, RLS, or production data rows.
- No Playwright CI track touched.
- No restoration writes.
- Recovery & Sync Health behavior unchanged — it just shows shorter numbers.
- The retained `BUILD_COMMIT` hash remains in audit records and Sentry releases (invisible to users) as a tiebreaker for traceability.

### Files touched
- `version.json` — set to `"4.8.0"`
- `vite-auto-version.ts` — stop deriving patch from git; read version.json as-is; keep `BUILD_COMMIT` injection
- `scripts/bump-version.mjs` *(new)* — `bump patch|minor|major` with 9-rollover
- `package.json` — add `"bump:patch"`, `"bump:minor"`, `"bump:major"` scripts; if auto-bump chosen, wire it into `prebuild`
- `src/lib/__tests__/version-rollover.test.ts` *(new)* — unit tests for the 9→rollover logic and comparator across the boundary

### Tests
- New unit tests for the bump script (9.x → x+1.0, 9.9 → major+1.0.0).
- Extend `version-check` self-tests for `4.9.9 → 5.0.0` ordering.
- Manual smoke after deploy: open profile dropdown, confirm all three lines read `v4.8.0`; deploy once more and confirm they all read `v4.8.1`.

### Decision needed before build
- **Auto-bump on every prod build (recommended) vs manual `npm run bump:patch`?** Reply with a preference, or say "go" and I'll use auto-bump.