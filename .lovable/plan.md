
## 1. Root cause hypothesis (high confidence)

**There is no version-system bug. Production has not been re-published since the P1 Sentry enum-normalization fix landed.** The displayed `4.8.1` is the true current production version. `4.8.2` does not exist yet anywhere — not in `version.json`, not in any built bundle, not on the CDN.

Evidence:
- `curl https://rwreports.com/version.json` → `{"version":"4.8.1","build":"dev"}` (live production)
- Repo `version.json` → `{"version":"4.8.0"}` (committed source of truth; the Vite plugin auto-bumps to the next patch *only on `mode === 'production'` builds*, which is what the Lovable Publish action runs — see `vite-auto-version.ts` lines ~80–95)
- The preview panel screenshot correctly says `preview build v4.8.0` / `installed v4.8.1` / `deployed v4.8.1 — update available`. That "update available" is the preview comparing its own dev build (4.8.0) to the last published prod build (4.8.1). It is *not* claiming a 4.8.2 exists.
- The "current" label on rwreports.com is correct: published `4.8.1` == deployed `4.8.1`.

So the P1 `"not inspected" → "na"` fix is in the workspace but has **not** shipped to end users. The next production Publish will bump `version.json` `4.8.0 → 4.8.1`… wait — see §3.

## 2. Current version sources (audit complete)

| Source | Value | Notes |
|---|---|---|
| `version.json` (repo) | `4.8.0` | SoT consumed by `vite-auto-version.ts` |
| `vite-auto-version.ts` | bumps patch on `build && mode==='production'` only | Single-digit rollover, writes back to `version.json` |
| `import.meta.env.APP_VERSION` | injected at build time | Read by `attestation.ts`, `version-check.ts`, `useVersionStatus`, `VersionInfoModal` |
| `/version.json` (build output) | emitted by plugin's `generateBundle` | What `rwreports.com/version.json` serves |
| `get-deployed-version` edge fn | proxies `rwreports.com/version.json` | Used by preview to show real prod version |
| `useVersionStatus` | compares `APP_VERSION` (installed) vs proxy/`/version.json` (deployed) | Correct semantics |
| SW (`vite-pwa-config`, `sw-sync.js`) | Workbox + custom SW | Cache versioning handled by Workbox revision hashes; `version.json` is excluded from precache (served `no-store` by Lovable proxy per PWA docs) |
| PWA manifest | `display: standalone` etc. | Manifest fields don't carry version |

The system is actually correctly designed: one source (`version.json`), one build-time bump, one runtime comparator. **The user's mental model ("4.8.2 should be live") is what's off, not the plumbing.**

## 3. The one real subtlety to flag

`version.json` in the repo is `4.8.0`, but production is serving `4.8.1`. That means the last production build bumped in-memory and wrote `4.8.1` to the build output, but the `4.8.1` value was **not committed back to the repo**. The plugin does `fs.writeFileSync(VERSION_FILE, ...)` at build time, but Lovable's publish pipeline doesn't commit that change back to git. So:

- Next production publish: plugin reads repo `4.8.0`, bumps to `4.8.1`, writes that to the bundle and to `/version.json`. **Result: production stays at `4.8.1`. No version bump visible to users.** The P1 fix would ship, but under the same version number — `useVersionStatus` would not flag "update available" for installed-PWA users still on the prior `4.8.1` build, because SemVer comparison returns equal.
- That is the only latent bug here, and it explains why "publish should bump to 4.8.2" feels intuitive but won't actually happen without intervention.

Fix options (pick one before publishing):
- **(A) Bump `version.json` to `4.8.1` in the repo** so the next prod build bumps to `4.8.2`. Minimal, matches user expectation, no code change.
- **(B) Bump `version.json` to `4.8.2` directly** and let the plugin push it to `4.8.3` on next publish. Same shape, one step ahead.
- **(C) Leave the plugin's auto-bump behaviour and accept that re-publishing without a repo commit will reuse the same patch. Document it.** Lowest churn but doesn't solve the "PWA update prompt won't fire" problem for already-installed users.

Recommended: **(A)**. It restores the invariant `repo version == last published version`, the next publish naturally produces `4.8.2` (which contains the P1 fix), and installed PWAs will correctly see "update available".

## 4. Proposed action (narrow)

1. Edit `version.json`: `"4.8.0"` → `"4.8.1"` (single-line change, matches the last actually-published version).
2. User clicks **Publish** in Lovable. Plugin bumps to `4.8.2`, writes new `/version.json` and `APP_VERSION`, emits to CDN.
3. Verify (see §8).

No code changes to the version-check pipeline, SW, manifest, or update UI. The pipeline is sound.

## 5. Files expected to change

- `version.json` — one line, `4.8.0` → `4.8.1`.

## 6. Files / areas explicitly NOT changing

- `vite-auto-version.ts`, `vite-pwa-config.ts`, `src/lib/version-check.ts`, `src/hooks/useVersionStatus.tsx`, `src/components/VersionInfoModal.tsx`, `src/components/pwa/*`, `src/lib/attestation.ts`, `supabase/functions/get-deployed-version/`, `public/sw-*.js`, `package.json`, PWA manifest, `.eslint-any-budget`, `.bundle-size-budget`, any report/sync/auth/IDB code.

## 7. Offline / PWA safety

- No SW cache-name change → no orphaned caches, no app-shell purge.
- No IndexedDB schema touch → reports, pending sync queue, photos, attestation, autocomplete history all preserved.
- Workbox `autoUpdate` + the existing `UpdateNotification`/`UpdateBadge`/`StaleVersionBanner` trio will surface the new build with the existing one-tap "INSTALL UPDATE" flow. iOS-standalone fallback hint already implemented.
- "Check for Updates" button (`forceVersionCheck`) already bypasses throttles and triggers `reg.update()`.

## 8. Verification plan

**Pre-publish (read-only):**
- Confirm `cat version.json` shows `4.8.1` after edit.
- Confirm grep finds no other version literal that needs syncing: `rg -n '"4\.8\.[0-9]"' --glob '!node_modules'`.

**Post-publish:**
1. `curl -s https://rwreports.com/version.json` → expect `{"version":"4.8.2","build":"<new sha>"}`.
2. `curl -s https://rwreports.com/version.json | jq -r .build` → diff against current `dev`/prior hash to prove a new bundle shipped.
3. Hard-reload `rwreports.com` in desktop Chrome → Version Info modal shows Installed `v4.8.2`, Deployed `v4.8.2`, "Current".
4. Installed PWA (desktop + iPad/Safari + Android): on next foreground, `StaleVersionBanner` or `UpdateNotification` appears with `v4.8.1 → v4.8.2`. Tap "INSTALL UPDATE" / "REFRESH" → reloads to `v4.8.2`. Verify reports, pending queue, photos still present.
5. P1 fix presence check (no PII): in DevTools console on the live `4.8.2` build, run `(await import('/src/lib/inspection-result-normalizer.ts')).normalizeInspectionResult('not inspected')` — expect `'na'`. (If the module is tree-shaken/minified, alternative: inspect Sentry over the next 24–72 h for zero new `systems[].result = "not inspected"` events tagged release `4.8.2`.)
6. Preview panel: should now show `installed v4.8.0` (preview's own) / `deployed v4.8.2 — update available`. The "update available" pill on the preview is expected and correct.

**Focused tests to run before publish:**
- `bunx vitest run src/lib/__tests__/version-rollover.test.ts src/lib/__tests__/inspection-result-normalizer.test.ts src/lib/__tests__/sw-sync-result-normalizer-mirror.test.ts`
- Expect all green; no code under test changed.

## 9. Cross-platform verification

Shared path — `version.json` is the single source consumed identically by desktop browser, installed PWA (Workbox + custom SW), iPad/Safari (with the existing iOS-standalone fallback hint in `StaleVersionBanner`), and mobile web. Admin vs regular-user: no role-gated code in the version pipeline, behaviour is identical. No per-platform branch added.

## 10. Should this block Slice 5?

**Yes, briefly.** Until production is republished:
- The P1 Sentry enum fix is not actually live.
- Slice 5 verification cannot meaningfully use "production confirms the fix" as a gate.

But the unblock is ~30 seconds of work (one-line `version.json` edit + Publish). After that, Slice 5 can proceed in parallel with the 24–72 h Sentry observation window.

## 11. Approval checkpoints

Before I touch anything, please confirm:
1. Approve option **(A)** — set `version.json` to `4.8.1` so next publish produces `4.8.2`.
2. Confirm you will click **Publish** after the edit (I can't trigger publish from here).
3. Confirm no other in-flight workspace changes should be held back from this publish (the publish will ship whatever else is in `main`).

On approval I will make the single-line edit and stop, then wait for your post-publish confirmation before continuing to Slice 5.
