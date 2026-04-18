

## Version Discrepancy Audit

### What the screenshots show
- Lovable preview iframe: **v4.7.1**
- Published site (rwreports.com / ropeworks.lovable.app): **v4.6.7**

Both are the *installed* APP_VERSION, read from `import.meta.env.APP_VERSION` injected at build time by `vite-auto-version.ts`. Different values = the two environments were built at different times from different commits. This is **expected behavior**, not a bug — but the UI makes it look like a bug because there's no signal that "Deployed v4.7.x is available, you're on v4.6.7."

### Root cause

1. **Two independent builds.** Lovable preview rebuilds on every code change (so it's always tip-of-tree, currently 4.7.1). The published site only rebuilds when the user clicks "Publish" (last published at 4.6.7). `version.json` in `/public` is whatever was committed at publish time.

2. **`version.json` may be stale on the published site.** `vite-auto-version.ts` bumps `APP_VERSION` at build but does it also rewrite `public/version.json`? If not, the published site shows installed=4.6.7 AND deployed=4.6.7 (both stale), so the "Update Available" banner never fires even after a republish — until `version.json` is manually bumped.

3. **The profile dropdown shows only installed version**, not deployed. So users can't tell whether they're stale.

### Other places version is shown / compared (audit)
- `UpdateControlPanel` — shows Installed + Deployed (already fixed last turn ✓)
- `UserProfileDropdown` — shows only `v{APP_VERSION}` (installed only) ✗
- `VersionBadge` / `VersionInfoModal` — need to check what they show
- `StaleVersionBanner` — fires on `version.json` mismatch ✓
- `MinVersionEnforcer` — compares against policy ✓
- `version_telemetry` — records client_version + server_version ✓
- Admin `VersionDistributionPanel` — shows fleet distribution ✓
- `attestation.ts` `APP_VERSION` constant — stamped on completed reports

### Gaps to fix

**Gap A — `vite-auto-version.ts` may not write `public/version.json`.**
Need to verify. If it doesn't, every publish ships a stale `version.json` and the entire deployed-version check (banner + panel + telemetry) is comparing against a frozen value. This is the highest-impact fix.

**Gap B — Profile dropdown shows only installed version, no deployed indicator.**
Add the same Installed/Deployed dual display + colored dot (green = current, amber = update available) directly in the dropdown so users see drift without opening the panel.

**Gap C — `VersionBadge` / `VersionInfoModal` consistency.**
Audit both to surface deployed version + status, matching the panel.

**Gap D — Lovable preview vs published mental model.**
Add a small "PREVIEW" or "PUBLISHED" tag next to the version in the dropdown when running on a Lovable preview host, so the discrepancy is self-explanatory ("you're looking at the preview build, not what your users see").

**Gap E — Republish guidance.**
When `version.json` shows the published site is behind the latest committed version (admin-only signal), surface a one-line nudge in the Super Admin Dashboard: "Latest committed: v4.7.1 — Published: v4.6.7 — Click Publish in Lovable to roll out."

### Plan

1. **Verify + fix `vite-auto-version.ts`** to also write `public/version.json` on every build. Without this, nothing else matters.
2. **Update `UserProfileDropdown.tsx`** to subscribe to `subscribeVersionCheck`, show Installed + Deployed with status dot, and add `PREVIEW`/`PUBLISHED` environment tag.
3. **Update `VersionBadge.tsx` + `VersionInfoModal.tsx`** to mirror the same Installed/Deployed display.
4. **Add admin nudge** in `VersionDistributionPanel.tsx` (or a new tiny component): if `version.json` deployed > current admin's installed, show "Republish recommended."
5. **No DB changes.** No migrations needed.

### Files
- EDIT: `vite-auto-version.ts`, `src/components/UserProfileDropdown.tsx`, `src/components/VersionBadge.tsx`, `src/components/VersionInfoModal.tsx`, `src/components/admin/VersionDistributionPanel.tsx`
- MEMORY: bump `mem://architecture/pwa-update-system` to note `version.json` write requirement + dropdown surfacing

### Risk
- `vite-auto-version.ts` change is build-time only; safe.
- Dropdown adds one subscription; tiny perf cost.
- No data risk.

