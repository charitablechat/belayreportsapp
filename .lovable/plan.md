

## Re-audit: remaining version-update gaps

The big-ticket fixes from the previous round are in place: monotonic patch, patch-aware comparator, no `public/version.json` mutation, build hash exposed, dev self-test. Re-reading the current code surfaces **four residual issues** that can still cause version drift or stale "up to date" reports.

### Residual gaps

**R1 — Build-hash mismatch is silently ignored**

`/version.json` now ships a `build` field (commit hash), and `version-check.ts` parses it into `deployedBuild`, but `isStale` only compares the SemVer string. If two deploys ever share `major.minor.patch` (shallow git clone in CI, force-push, branch reset), the running client and the deployed client report identical versions while running different bundles — and `StaleVersionBanner` will never fire. This is the last silent-divergence path.

**Fix:** In `checkVersion()`, set `isStale` to `true` when the SemVer is equal **but** `deployedBuild` is non-null and differs from the locally-defined `BUILD_COMMIT`. Strict-equal hash mismatch is a definitive "you're on the wrong bundle" signal.

**R2 — `VersionDistributionPanel` polls the wrong host**

It hardcodes `https://ropeworks.lovable.app/version.json`, but the actual published custom domain users hit is `rwreports.com` (and there's a `www.rwreports.com` alias). Three problems:

- Cross-origin fetch from preview/local→`ropeworks.lovable.app` may be blocked by CORS or return a stale CDN copy that lags `rwreports.com` by minutes.
- Admins viewing the panel from `rwreports.com` would do an unnecessary cross-origin request when same-origin `/version.json` is right there.
- "Published version" displayed in the admin panel may not match what users actually run.

**Fix:** Always fetch same-origin `/version.json` when the panel is loaded from `rwreports.com`/`www.rwreports.com`/`ropeworks.lovable.app`. Only fall back to the absolute URL when running from a preview/local host. Use `rwreports.com` as the fallback (the canonical user-facing domain), not `ropeworks.lovable.app`.

**R3 — `isBelowMinimum` doesn't strip `+build` suffix**

`version-policy.ts` splits on `.` directly. If a future build or admin-entered policy includes a `+hash` or `-rc` suffix, `parseInt('142+a3f29c1', 10)` happens to work (parses leading digits) but `parseInt('1-rc', 10)` returns `1` correctly only by accident. The brittleness will eventually bite.

**Fix:** Reuse the same `stripSuffix` helper (export it from `version-check.ts`) before splitting, mirroring `isVersionNewer`. Also short-circuit on `'unknown'` consistently.

**R4 — Telemetry collides if two builds ever share a version string**

Upsert key is `(user_id, platform, client_version)`. With monotonic patch this should never happen, but defense-in-depth: include build hash in the row so the admin panel can disambiguate. No constraint change needed; just add a `build_hash` column write (existing `text` column or skip if not present — verify schema before deciding).

**Fix:** If `version_telemetry` already has a `build_hash`/`build` column, write it. Otherwise, append `+{hash}` to `client_version` only when present. Simplest no-migration option: store as `client_version = "${version}+${hash}"` (truncated to 64 chars). The `isVersionNewer` comparator already strips `+` suffixes, so distribution math still works.

### Already-correct (verified, don't touch)

- `vite-auto-version.ts` — monotonic commit-count patch, dist-only `/version.json` emission, dev middleware, build-hash export, git-fallback warning.
- `isVersionNewer` — three-segment compare, suffix stripping, dev self-test, equal-string fast path.
- `vite-pwa-config.ts` — `/version.json` excluded from precache + `NetworkOnly` runtime cache + `navigateFallbackDenylist`.
- `usePWAUpdate` — foreground throttled `reg.update()`, `pageshow`/`visibilitychange`/`focus` triggers, `SKIP_WAITING` + `controllerchange` reload.
- `StaleVersionBanner` — iOS standalone cache-clear before reload.
- `MinVersionEnforcer` — sync-before-reload guard, hard/soft modes.
- `UpdateControlPanel` — exposes installed/deployed build hashes, parallel `forceVersionCheck` + `checkForUpdates`.

### Files to change

- `src/lib/version-check.ts` — R1 (hash-mismatch staleness), export `stripSuffix`.
- `src/components/admin/VersionDistributionPanel.tsx` — R2 (same-origin first, correct fallback).
- `src/lib/version-policy.ts` — R3 (suffix-strip + `'unknown'` guard).
- `src/lib/version-telemetry.ts` — R4 (write build hash into `client_version` field, defensively trimmed).

No DB migrations. No edge functions. ~30 LOC net.

### Risk

- **R1:** `isStale=true` when only the hash differs is technically correct. Edge case: a dev with `BUILD_COMMIT='dev'` (no git) viewing a published `/version.json` that has a real hash — banner would fire unnecessarily. Mitigation: skip hash compare when local hash is `'dev'` or empty.
- **R2:** Same-origin path eliminates CORS risk entirely. Fallback to `rwreports.com` matches what real users hit. Worst case: corp proxy blocks `rwreports.com` from a preview host — same failure mode as today, just with a more accurate URL.
- **R3:** Strictly more lenient parser. No new false positives.
- **R4:** Lengthens `client_version` strings to ~30 chars max. Already trimmed to 64. Existing telemetry rows keep working; new rows include the hash. Distribution panel grouping by `client_version` will show one row per real build (correct).

### Expected outcomes

- A device running a build with the same SemVer but different bundle hash than the deployed copy will surface the stale banner.
- Admin Version Distribution panel always shows the same value users see.
- Telemetry rows are uniquely identifiable per real deploy.
- Future suffix variants (`+hash`, `-rc1`) won't break the min-version enforcer.

### Verification

1. Manually edit local `/version.json` response to return same version but different `build` → `StaleVersionBanner` fires.
2. From a dev environment with `BUILD_COMMIT='dev'`, banner does **not** fire on hash mismatch.
3. Open Version Distribution panel from `rwreports.com` → DevTools shows a same-origin `/version.json` request (no CORS preflight to `ropeworks.lovable.app`).
4. Open same panel from a Lovable preview → falls back to `https://rwreports.com/version.json`.
5. Admin sets min-required-version to `4.7.150+abc1234` → `isBelowMinimum` correctly compares the numeric core.
6. After three deploys, `version_telemetry` shows three distinct `client_version` rows per active user/platform (each suffixed with its build hash).
7. Existing dev self-tests for `isVersionNewer` still pass (no regression).

