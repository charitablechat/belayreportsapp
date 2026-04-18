

## Phase 2 + All Cross-Platform Gaps — Execution Plan

Executing all 9 gaps from the previous audit in one pass.

### Phase 2 — Real Service Worker (Gap 1)
- **Delete** `public/sw.js` (self-destroyer)
- **Edit** `vite-pwa-config.ts`: `registerType: 'autoUpdate'`, `injectRegister: 'auto'`, exclude `/version.json` from precache + runtime cache
- **Edit** `src/main.tsx`: remove manual `register('/sw.js')` block; rely on VitePWA virtual module
- **Edit** `src/hooks/usePWAUpdate.tsx`: switch to `useRegisterSW` from `virtual:pwa-register/react`

### iOS/macOS Cache Busting (Gaps 2, 3, 4, 7)
- **Edit** `vite-pwa-config.ts`: ensure `updateViaCache: 'none'` on registration
- **Edit** `src/lib/version-check.ts`: already cache-busts with `?t=${Date.now()}` + `cache: 'no-store'` (verify); add `visibilitychange` listener that calls `registration.update()` when tab returns to foreground
- **Edit** `src/components/pwa/StaleVersionBanner.tsx`: when iOS standalone (`navigator.standalone === true`), Refresh button clears `caches.keys()` first then `location.reload()`
- **Edit** `index.html`: confirm preview-cleanup script is strictly hostname-gated

### Field-Merge Skew Test (Gap 8)
- **Add** test case to `src/lib/field-merge.test.ts`: "old client without field_timestamps does not overwrite new client's field-timestamped value"

### Telemetry & Admin Visibility (Gap 9)
- **Migration**: new `version_telemetry` table (user_id, client_version, server_version, platform, last_seen) + RLS (admin read, user upsert own)
- **New** `src/lib/version-telemetry.ts`: upserts row on app load + when version mismatch detected
- **New** `src/components/admin/VersionDistributionPanel.tsx`: bar chart of client_version distribution; mounted in `SuperAdminDashboard`
- **Edit** `src/App.tsx`: call telemetry on mount

### Windows Reinstall Notice (Gap 6)
- **New** one-time toast in `src/App.tsx` for Windows users with installed PWA detected pre-Phase 2 — surfaces uninstall+reinstall recommendation. Stored in localStorage so shown once.

### WebAPK Documentation (Gap 5)
- **Edit** `README.md`: add "Android WebAPK update lag" section noting 1–30 day Play Services manifest refresh window

### Memory
- **New** `mem://architecture/pwa-update-system` documenting: autoUpdate SW, version.json polling, iOS cache mitigations, telemetry table

### Files touched
- DELETE: `public/sw.js`
- EDIT: `vite-pwa-config.ts`, `src/main.tsx`, `src/hooks/usePWAUpdate.tsx`, `src/lib/version-check.ts`, `src/components/pwa/StaleVersionBanner.tsx`, `index.html`, `src/lib/field-merge.test.ts`, `src/App.tsx`, `src/pages/SuperAdminDashboard.tsx`, `README.md`
- NEW: `supabase/migrations/...version_telemetry.sql`, `src/lib/version-telemetry.ts`, `src/components/admin/VersionDistributionPanel.tsx`
- MEMORY: new `mem://architecture/pwa-update-system`

### Risk
- Existing users carry the self-destroying SW. On first load post-deploy, old SW unregisters itself one final time; on next load, VitePWA's autoUpdate SW takes over. Two-load transition — acceptable per "Safe" rollout choice already approved.
- No DB data risk; telemetry table is additive.
- iOS users on stale builds see the banner immediately (already deployed in Phase 1) and will receive auto-updates once their next visit picks up the new SW.

<lov-actions>
<lov-suggestion message="Test PWA update delivery end-to-end on iOS Safari, Android Chrome, and Windows Edge — confirm version banner appears and auto-update applies on next visit">Verify cross-platform updates work</lov-suggestion>
<lov-suggestion message="Show me the version distribution panel in the admin dashboard once telemetry has data">Check version distribution</lov-suggestion>
<lov-suggestion message="Add a 'Force update all users' admin action that bumps a server-side minimum-required version and forces reload on clients below it">Add force-update admin action</lov-suggestion>
<lov-suggestion message="Add Sentry or similar error tracking so we catch SW registration failures in production">Add error tracking</lov-suggestion>
</lov-actions>

