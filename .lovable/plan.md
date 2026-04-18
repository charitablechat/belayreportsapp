

## Make "Check for Updates" Truly Live + Enforce Version Consistency

### Gaps right now

1. **`UpdateControlPanel` doesn't show server version.** It only displays `APP_VERSION` (the running client) and SW-based `needsUpdate`. If `version.json` shows v4.8 but client is v4.7, the panel still says "UP TO DATE" until the SW happens to flip.
2. **Opening the panel doesn't trigger a poll.** `lastUpdateCheck` only updates from background timers — opening the sheet shows whatever time is cached.
3. **"Check Now" only nudges the SW.** It doesn't re-fetch `/version.json`, so a stale-but-SW-quiet client looks healthy.
4. **No enforced consistency.** No mechanism to require all clients to be on a minimum version — drift just accumulates.

### Fixes

**A. Live panel data on open + on-demand**
- Export a `forceVersionCheck()` from `src/lib/version-check.ts` that runs `poll()` immediately and returns the result.
- `UpdateControlPanel`: on `open === true`, call `forceVersionCheck()` + `checkForUpdates()` in parallel. Show a spinner while running.
- Subscribe the panel to `subscribeVersionCheck` so `deployedVersion` updates live while open.
- Display a new "Deployed" row beneath "Version" — green check if equal, amber arrow if newer available.
- Recompute `statusLabel`: if `deployed` newer than `current` → "UPDATE AVAILABLE" even when SW hasn't fired yet. Apply button calls SW update if `needsUpdate`, else falls back to `location.reload()` after cache clear.

**B. Auto-refresh while panel open**
- While the sheet is open, run `forceVersionCheck()` every 15s (cleared on close). Gives instant feedback without spamming when closed.

**C. Version-consistency enforcement (minimum required version)**
- New table `app_version_policy` (singleton row): `min_required_version text`, `recommended_version text`, `enforce_hard_reload bool`, `updated_at`.
- RLS: anyone authenticated can read; only admins can update.
- New `src/lib/version-policy.ts`: fetches policy on app load + every 5 min; cached.
- If `APP_VERSION < min_required_version`:
  - **Soft mode** (`enforce_hard_reload = false`): persistent non-dismissable banner "This version is no longer supported — please refresh." Already-open work isn't lost.
  - **Hard mode** (`enforce_hard_reload = true`): show full-screen modal blocking app use; "Refresh Now" button clears caches + reloads. Respects `unsyncedCount` — sync first, then reload.
- New admin panel `MinVersionPolicyPanel.tsx` in `SuperAdminDashboard` next to `VersionDistributionPanel`: read `version_telemetry` to see distribution, set min/recommended versions with a single form. Confirms before applying hard mode.

**D. Telemetry tightening**
- Bump `version-telemetry.ts` `last_seen` whenever `forceVersionCheck` runs (so admin panel shows truly live "users on each version" counts, not stale).

### Files

**NEW**
- `src/lib/version-policy.ts` — policy fetcher + cached signal
- `src/components/pwa/MinVersionEnforcer.tsx` — soft banner + hard modal
- `src/components/admin/MinVersionPolicyPanel.tsx` — admin form
- Migration: `app_version_policy` table + RLS + seed singleton row

**EDIT**
- `src/lib/version-check.ts` — export `forceVersionCheck()`, expose `lastResult` getter, broadcast on every poll (not only when stale) so UI can show "deployed" even when equal
- `src/components/pwa/UpdateControlPanel.tsx` — on-open poll, live "Deployed" row, 15s in-panel refresh, smarter status label, subscribe to version-check
- `src/lib/version-telemetry.ts` — re-touch `last_seen` on `forceVersionCheck`
- `src/App.tsx` — mount `<MinVersionEnforcer />`
- `src/pages/SuperAdminDashboard.tsx` — mount `<MinVersionPolicyPanel />`

### Risks
- Hard-mode policy could lock out users if admin sets `min_required_version` higher than any deployed build. Mitigation: confirmation dialog showing "This will lock out X% of currently-active users (per telemetry)" before save.
- No DB data risk; additive table.
- Backwards compatible: missing policy row = no enforcement.

### Out of scope
- Real-device cross-platform QA (already covered by prior plan; user verifies post-deploy).

