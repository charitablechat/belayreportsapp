

## Why the new UI isn't on the webpage yet

The new `VersionStatusLine`, environment tag, and deployed indicator code is **already written and live in the preview** (v4.7.6). But your **published site is still running v4.6.7** — a build from before any of this work existed. Published sites only rebuild when you click **Publish** in Lovable. Until then, every user on rwreports.com / ropeworks.lovable.app sees the old v4.6.7 UI, no matter what platform or device.

### What "will this show up everywhere" actually requires

1. **You click Publish in Lovable.** This bundles current code (v4.7.6+) and ships it to the published domains.
2. **Each user's browser fetches the new build.** With the Phase 2 PWA work already done:
   - First visit after publish: service worker downloads new assets in the background.
   - Second visit (or foreground after the visibility-change check): new build activates → user sees the new dropdown UI.
   - iOS standalone users: `StaleVersionBanner` prompts a cache-clearing reload.
   - Anyone stuck behind the minimum-version policy: `MinVersionEnforcer` forces them current.

So yes — once you Publish, the new dropdown UI propagates to **all users on all platforms** (iPhone, iPad, Android, Windows, macOS, web) within one or two app opens, automatically. No further code is needed for that.

### The only remaining gap worth fixing

There's no in-app reminder telling **you** (the admin) when the published site is behind the preview. The `VersionDistributionPanel` "Republish recommended" banner I added last turn only fires for an admin who is *themselves* on a newer build than `version.json` reports — but you're viewing the panel inside the **preview iframe**, which always reads its own `version.json`. So the nudge can be misleading.

### Plan

**One small change:** make the admin "Republish recommended" nudge environment-aware.

- **Edit `src/components/admin/VersionDistributionPanel.tsx`**: when running on a Lovable preview host (use `getEnvironment()` from `useVersionStatus`), explicitly compare the preview's `APP_VERSION` against the **published** `version.json` (fetch directly from `https://ropeworks.lovable.app/version.json`). If preview is ahead, show:
  > "Preview is on v4.7.6 — Published site is on v4.6.7. Click Publish in Lovable to roll out."
- When running on a published host, keep the existing local-vs-deployed comparison.

**No other files need changes.** The dropdown, badge, modal, and update panel are all correct — they just need the published build to ship.

### Files
- EDIT: `src/components/admin/VersionDistributionPanel.tsx` (~20 lines added)

### After this lands
1. Click **Publish** in Lovable to ship v4.7.6+ to rwreports.com.
2. Within 1–2 visits per user, the new profile dropdown UI (with PREVIEW/PUBLISHED tag + deployed line + status dot) appears for everyone, everywhere, automatically.

### Risk
- Cross-origin fetch to `ropeworks.lovable.app/version.json` from the preview host — `version.json` is a static public asset, CORS-permissive by default on Lovable's CDN. If it ever fails, panel silently falls back to the existing comparison. No data risk.

