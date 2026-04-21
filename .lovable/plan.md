

## Version-update audit — why versions diverge across devices/users

### Root cause #1 (the big one): patch number is `(commitCount % 9) + 1` → only 9 unique patch slots

In `vite-auto-version.ts`:

```ts
const patch = (commits % 9) + 1; // 1..9
```

The "version" baked into a build is `major.minor.((commits % 9) + 1)`. That patch only has **9 possible values**. Every 9 commits the version **wraps back to the same string**.

Concrete failure modes this produces, all observed in the logs:

- Device A is on `v4.7.5`. A new build ships and the new computed version is **also `v4.7.5`** (because commit count rolled over modulo 9). `version.json` returns `4.7.5` → `isVersionNewer` returns `false` → **"UP TO DATE"** even though the JS bundle is brand new. Different device that updated at a different rollover point may show `v4.7.6` for the same deployed bundle. **This is exactly why versions disagree across devices.**
- Two consecutive deploys can publish the same version string. The SW *does* get a new bundle (precache manifest hash changes), but `/version.json` says no update → `StaleVersionBanner` never appears, `MinVersionEnforcer` can't tell who's actually behind, and `version_telemetry` rows collide on the unique `(user_id, platform, client_version)` key — so the admin distribution panel reports stale version mixes.
- Live network logs prove this is happening right now: `version.json` is consistently returning `4.7.5` while `public/version.json` in the repo says `4.7.6`. The `viteAutoVersion.config()` hook is rewriting `public/version.json` on every dev-server start to whatever `(commits % 9)+1` resolves to — the on-disk file you see committed (`4.7.6`) is **routinely overwritten back to a lower patch** by the next `vite dev` boot.

### Root cause #2: `public/version.json` is mutated by the build plugin

`viteAutoVersion.config()` writes `public/version.json` synchronously on every Vite startup. This means:

- The committed `public/version.json` is meaningless — it gets clobbered on every dev/build run.
- In CI/Lovable Cloud, build #1 writes `4.7.5`, ships, then build #2 (one commit later) writes `4.7.6`, ships. So far so good — but build #10 wraps and writes `4.7.5` again. Devices that cached `4.7.6` will see the deployed `4.7.5` and `isVersionNewer` returns `false` (older→newer comparison fails) → **stale clients get flagged as up-to-date.**
- Worse: `isVersionNewer` only compares `major` and `minor` (line ~46 of `version-check.ts`). The patch is **completely ignored** in the comparison. So even when the patch *does* differ correctly (e.g. `4.7.5` → `4.7.8`), the function returns `false`. The only way the soft-refresh banner ever fires is when `minor` increments — which happens once every 9 commits at best.

### Root cause #3: `isVersionNewer` ignores patch entirely

```ts
const [cMaj, cMin] = parse(current);   // patch dropped
const [dMaj, dMin] = parse(deployed);  // patch dropped
if (dMaj > cMaj) return true;
if (dMaj === cMaj && dMin > cMin) return true;
return false;
```

Combined with #1, this means the staleness check is effectively dead for ~95% of deploys. `StaleVersionBanner` never shows. `useVersionStatus().updateAvailable` stays `false`. The only thing that surfaces updates is the SW `updatefound` event — and on iOS Safari/corp proxies that's exactly the path that's known to silently fail, which is why the dual-channel system was built in the first place.

### Root cause #4: telemetry unique constraint hides version drift

`version_telemetry` upsert uses `onConflict: 'user_id,platform,client_version'`. Because patch wraps modulo 9, a single user toggling between two builds that both compute to `v4.7.5` produces **one row**, not two. The admin distribution panel cannot distinguish a user on the *real* latest build from one on a months-old build that happens to share a patch slot.

### Root cause #5: published vs preview hosts can compute different versions

`vite-auto-version` uses `git rev-list --count HEAD` to compute patch. On Lovable Cloud's ephemeral build container, the git history may be shallow (commit count = 1 or small) — meaning the published build patch can differ from a developer's local-checkout patch by a large amount, **for the same source code**. Two devices installed from two different deploy origins (e.g. preview vs published) end up reporting different versions for what is effectively the same release line.

### Already-correct pieces (don't touch)

- VitePWA `autoUpdate` + `updateViaCache: 'none'`
- `/version.json` excluded from precache + `NetworkOnly` runtime cache
- Foreground SW `reg.update()` triggers on `pageshow`/`focus`/`visibilitychange`
- Throttle on `forceVersionCheck`
- iOS standalone cache-clear on refresh in `StaleVersionBanner`
- Service worker `SKIP_WAITING` + `controllerchange` reload sequence in `usePWAUpdate`

---

## Fix plan

### F1 — Replace the modulo-9 patch with a monotonic build counter

Change `computeVersion()` in `vite-auto-version.ts` to never wrap. Use the **full commit count** as the patch with no modulo:

```ts
const patch = commits; // monotonically increases forever
return `${major}.${minor}.${patch}`;
```

If the user wants the rollover scheme preserved for *display* (the comment says minor rolls at .10), that's fine to keep in the UI formatter — but the **internal version string used for comparison must be monotonic and unique per build**. Two strategies, pick one:

- **Simple (recommended):** drop the rollover entirely. Patch grows: `4.7.142`, `4.7.143`, … Display it verbatim. The "v2.3.9 → v2.4.1" rollover is cosmetic and doesn't survive the modulo-9 bug anyway.
- **Cosmetic rollover preserved:** keep the monotonic patch internally but format `displayVersion` separately for UI. Adds complexity for no real win.

### F2 — Make `isVersionNewer` actually compare patch

Update `src/lib/version-check.ts`:

```ts
const parse = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0);
const [cMaj, cMin, cPatch] = parse(current);
const [dMaj, dMin, dPatch] = parse(deployed);
if (dMaj !== cMaj) return dMaj > cMaj;
if (dMin !== cMin) return dMin > cMin;
return dPatch > cPatch;
```

This fixes the staleness banner across the board, regardless of F1.

### F3 — Stop mutating `public/version.json` from the build plugin

Remove the `fs.writeFileSync(publicVersionPath, …)` block in `viteAutoVersion.config()`. Reasons:

- The committed file becomes a source of confusion (devs see one value, runtime serves another).
- The dist-emitted `version.json` (from `generateBundle`) already overrides anything in `public/` for builds.
- Deleting `public/version.json` from the repo entirely is cleaner — the build pipeline emits the live one.

After this change, `public/version.json` either gets removed or kept as a hard-coded fallback the build always overrides. Recommendation: **delete it from the repo** and let the build emit the only canonical copy.

### F4 — Add commit-hash suffix (or full timestamp) to the version string for true uniqueness

To guarantee no two builds ever share a version, even in pathological CI scenarios (shallow clones, force-pushes that reset commit count), include the short commit hash in the version when available:

```ts
return `${major}.${minor}.${patch}+${hash}`;
```

Comparison logic strips anything after `+`. Display can show or hide the suffix. This makes telemetry rows unique per real build and makes it possible to debug "why is this device stuck on this build" by reading the suffix.

Optional alternative if the `+` syntax causes UI noise: store hash in a separate `build` field in `/version.json`:

```json
{ "version": "4.7.142", "build": "a3f29c1" }
```

…and surface it in the Update panel under Installed/Deployed for diagnostics.

### F5 — Update `version_telemetry` unique key to include `app_version_at_completion`-style granularity

After F1+F4, the existing `(user_id, platform, client_version)` constraint becomes correct again because `client_version` is now genuinely unique per build. **No DB migration needed if F1+F4 land** — collisions disappear naturally.

If we adopt the `+hash` suffix, optionally bump the column length and trim to 64 chars in `version-telemetry.ts` for safety. No schema change required (`text` is unbounded).

### F6 — Add a one-shot self-test in dev to catch regressions

In `version-check.ts`, add a dev-only assertion that `isVersionNewer('4.7.5', '4.7.6')` returns `true` and `isVersionNewer('4.7.10', '4.7.9')` returns `false`. Throws loudly in dev if the comparator is ever broken again. Costs nothing in prod.

### F7 — Verify Lovable Cloud build actually has git access

Add a one-line build-time log: if `getCommitCount()` falls into the time-based fallback branch, print a clear `[vite-auto-version] WARNING: git unavailable, using time-based fallback` to the build output. Currently the fallback happens silently — if Cloud's container ever loses git, every build gets a wildly different patch derived from minutes-since-2025 and devices diverge instantly.

---

## Files to change

- `vite-auto-version.ts` — F1 (drop modulo), F3 (remove public/version.json mutation), F4 (commit hash in version string or build field), F7 (warn on git fallback)
- `src/lib/version-check.ts` — F2 (compare patch), F6 (dev self-test), strip `+hash` suffix before comparing
- `src/lib/version-telemetry.ts` — pass through hash if using `build` field; trim length defensively
- `src/components/pwa/UpdateControlPanel.tsx` — optionally show build hash under Installed/Deployed for diagnostics
- `public/version.json` — **delete** (build emits canonical copy)

No DB migrations. No edge functions. ~40 LOC net.

## Risk

- **F1 (monotonic patch):** version string grows past `.9`. UI must render `4.7.142` correctly. The current display code in `UpdateControlPanel`, `VersionBadge`, `StaleVersionBanner`, `MinVersionEnforcer` all use `v{version}` interpolation — all fine with multi-digit patch. The `version-calculator.ts` rollover logic is referenced for *naming* but is independent of build versioning and stays untouched.
- **F2 (patch comparison):** strictly more correct. Could cause `StaleVersionBanner` to fire on devices that were silently stale — that's the goal. No false positives because it's still strict `>`.
- **F3 (delete public/version.json):** dev server now serves the dist-emitted file via Vite's middleware (it already does — `version.json` shows up in network logs in dev). If a dev opens `vite preview` before `vite build`, `/version.json` 404s. Acceptable; add a comment in vite config explaining the behavior.
- **F4 (+hash suffix):** the only risk is third-party code splitting on `.` — none in our codebase does. Comparator strips suffix safely.
- **F5/F6/F7:** no risk.

## Expected outcomes

- Two devices on the same deployed build always report the same version string.
- `StaleVersionBanner` fires for every real version drift, not just minor bumps.
- `version_telemetry` admin panel shows accurate distribution — no more collision-merged rows.
- `MinVersionEnforcer` can target exact builds, not 9-build ranges.
- Debuggable: each build's hash is visible in the Update panel.

## Verification

1. Build twice in a row with no git changes → identical version string both times. Confirm `version.json` matches.
2. Make a single commit → rebuild → version patch increments by exactly 1 (was: could wrap to a lower number).
3. Open Update panel on Device A immediately after deploying a new build → "Update Available" shows within 30s (was: silent if patch wrapped).
4. Compare `Installed` and `Deployed` in the panel across two devices on the same deploy → identical strings.
5. Run the comparator self-test in dev (`isVersionNewer('4.7.9','4.7.10')===true`) — passes.
6. Query `version_telemetry` distribution after 3 deploys → 3 distinct `client_version` values per active user/platform (was: 1).
7. Disable git in a build sandbox → build still succeeds and prints the fallback warning.
8. Click "Check Now" in panel → polled `/version.json` returns the build-time-emitted canonical value, never the stale committed `public/version.json`.

