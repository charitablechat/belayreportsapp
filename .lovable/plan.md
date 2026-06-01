## Goal

Make the version badge in the Lovable preview show the **deployed** production version (e.g. `v4.8.1`) instead of the preview bundle's local version (`v4.8.0`), so the number you see in preview matches what users actually have on `rwreports.com`.

Production behavior is unchanged — published builds keep displaying their own `APP_VERSION` as today.

## Why preview drifts behind today

`vite-auto-version.ts` only auto-bumps the patch on `command === 'build' && mode === 'production'`. Lovable preview runs Vite in dev mode, so it reads `version.json` (currently `4.8.0`) as-is. The production deploy bumps the patch in its own filesystem and emits `/version.json` at `4.8.1`, but that write never makes it back to the committed repo. Result: preview is always one (or more) deploys behind.

## Approach (Option B — display-only, no build-pipeline changes)

In the Lovable preview environment **only**, the badge displays the deployed version polled from the production origin's `/version.json`, with the local build version shown as a smaller sublabel. Everywhere else (published site, installed PWA, local dev outside Lovable), behavior is identical to today.

### Detection

Reuse the existing `isPreviewOrIframeEnvironment()` helper from `src/lib/environment.ts` (already used by `StaleVersionBanner` to suppress itself in preview). No new env detection logic.

### Data source

Reuse the existing version-check polling in `src/lib/version-check.ts` (already subscribed to by `StaleVersionBanner` and `useVersionStatus`). It fetches `/version.json` from the deployed origin. We add nothing new on the network.

The Lovable preview is served from a different origin than `rwreports.com`, so a same-origin `/version.json` fetch from preview returns the preview build's own version (also `4.8.0`) — not what we want. So in preview mode the badge needs to fetch from a **pinned production origin**.

Pinned origin: `https://rwreports.com/version.json` (the custom-domain production URL already listed in project URLs). Fetched with `cache: 'no-store'`, on mount and on a 60s interval, with a 5s timeout. On failure (offline, CORS, 5xx) we fall back silently to the local `APP_VERSION` so the badge never goes blank or shows an error.

### UI change (scoped to `VersionBadge.tsx`)

When in preview:
- Primary line: `v{deployedVersion}` (e.g. `v4.8.1`)
- Sub-line (smaller, muted): `preview build v{APP_VERSION}` (e.g. `preview build v4.8.0`)
- Dot color: green if `deployed === installed`, amber otherwise (same semantics as today)

When NOT in preview: exactly today's rendering — single line `v{APP_VERSION}` — no change.

The existing `VersionInfoModal` opened on click already shows installed vs deployed in detail, so no modal changes are needed.

### What does NOT change

- `vite-auto-version.ts` — untouched
- `version.json` — untouched
- `version-policy.ts`, `MinVersionEnforcer`, `StaleVersionBanner` — untouched
- Production build output, audit version stamps, attestation `APP_VERSION` — untouched
- Sync, IDB, service worker, edge functions, RLS — untouched
- The account dropdown's existing "installed v4.8.0 / deployed v4.8.0 — current" block already pulls from `useVersionStatus`; once the hook returns a deployed value in preview, that block updates automatically with no code change.

## Files

**Edited (2):**
- `src/hooks/useVersionStatus.tsx` — in preview mode, fetch `https://rwreports.com/version.json` (timeout 5s, interval 60s, no-store) and expose its `version` as `deployed`. Outside preview, current behavior preserved.
- `src/components/VersionBadge.tsx` — conditional two-line rendering when `isPreviewOrIframeEnvironment()` returns true; single-line otherwise.

**No new files. No migrations. No edge functions. No dependencies.**

## Risks & guards

- **CORS:** `rwreports.com/version.json` is a static asset served by the same Vite/PWA stack; should respond with permissive headers. If it does not, fallback path leaves the badge showing `v{APP_VERSION}` (identical to today). Verify by curling the URL during implementation; if CORS blocks, switch the pinned URL to `ropeworks.lovable.app` (same project, Lovable origin, known-permissive).
- **Wrong number shown briefly:** On first paint before the fetch resolves, the badge shows local `APP_VERSION`. Acceptable — matches today's behavior and resolves within ~1s.
- **Stuck-deployed value:** If `rwreports.com` is down, we keep the last-known deployed value for the session, then fall back to local. No user-facing error.

## Verification

1. Open Lovable preview → badge reads `v4.8.1` with `preview build v4.8.0` sub-line.
2. Open `rwreports.com` → badge reads `v4.8.1` (single line, unchanged).
3. Open published `ropeworks.lovable.app` → badge reads its own deployed version (single line, unchanged).
4. Network: confirm only one extra GET per 60s in preview, none in production.
5. Confirm `VersionInfoModal` still opens on click and shows the same installed/deployed/current block.

## Out of scope

- Auto-bumping in preview builds (Option C — rejected; would churn `version.json`)
- Manual post-publish bump workflow (Option A — superseded by this)
- Any change to how production version numbers are generated or stored
