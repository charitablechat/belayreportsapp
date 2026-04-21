

## Audit: data loss between devices + UI inconsistencies

### What the screenshots actually show

| # | Image | Symptom | Root cause |
|---|-------|---------|------------|
| 1 | iPad Safari corner | Two sync icons, one with a duplicate "S" badge, no profile chip visible | `AuthenticatedHeader` returns `null` until `currentUser` is fetched — on cold load with slow auth this leaves the chip empty while the duplicate `ForceSyncButton` renders |
| 2 | iPhone — published site | Header shows logos + sync icons, but no profile/account chip at all | Same `currentUser==null` race + `AuthenticatedHeader` is gated on `isPublicRoute` check that treats `/` as public, so the chip never shows on the welcome screen |
| 3 | Windows laptop dropdown | Account, then `luke@ropeworksinc.com` wraps awkwardly, version `v4.6.6` (old) | `DropdownMenuLabel` has no `break-all` / `truncate`, and the user is on the **published** build (v4.6.6) which predates the new `VersionStatusLine` — that's why no PREVIEW/PUBLISHED tag |
| 4 | Same dropdown, different angle | Same v4.6.6, no env tag, no deployed line | Same — published site hasn't been re-published since the dropdown was upgraded |
| 5 | iPhone install banners overlapping welcome | `IOSInstallPromptOnce` and `BackgroundSyncStatus` stack and crowd out the welcome card | Both render unconditionally on every page mount with no dismiss persistence working on iOS standalone |

So there are **two separate problem clusters**: (A) the data-loss report and (B) the UI inconsistencies in the screenshots. Audit each.

---

### Cluster A — Data loss: "uploaded report, came back hours later, only the empty shell remained"

#### Where the loss happens

Tracing the lifecycle of a single inspection across `Dashboard.tsx`, `useAutoSync.tsx`, `atomic-sync-manager.ts`, and `InspectionForm.tsx`, there are **three independent vectors** that can wipe child rows (systems / ziplines / equipment / standards / summary) while leaving the parent inspection intact — exactly matching "only the empty report remained":

**Vector 1 — Dashboard cache overwrite of unsynced parent (already partially guarded)**
`Dashboard.loadInspections()` (line ~660) writes every server-fetched parent into IndexedDB via `saveInspectionOffline`. It now uses `shouldPreserveLocalRecord` correctly for the parent, **but it does nothing for child rows**. The parent row gets refreshed with `synced_at = now`; if the form had unsynced child edits, the next load passes `isLocalDataNewer` check (because `synced_at` was just bumped) and the form treats local as "not newer," then…

**Vector 2 — Form loader: server-empty child arrays silently win**
`InspectionForm.tsx` lines 1213-1275: if the server returns empty arrays for systems/ziplines/equipment, the code logs a warning ("preserving local") **but never re-asserts the local state into React**. Whether the displayed list ends up empty depends on whether `offlineSystems`/etc. were already pushed into state earlier. They are — but only inside the `localIsNewer` branch. In the `else` branch (server-current path), if `systemsData.length === 0`, the `else if (offlineSystems.length > 0)` branch logs the warning **and falls through with `setSystems` never called**, leaving whatever was in state from initial mount. If the initial offline read returned `[]` due to the 4-second timeout (note the console: `[Offline Storage] IndexedDB open timed out after 3s`), state stays empty.

**Vector 3 — Cross-device sync race wiping child rows server-side**
When Device B opens an inspection while Device A is mid-edit, Device B's `loadInspectionData` (line 1213+) reads the parent + empty children from server (because A hasn't synced yet), then `saveRelatedDataOffline` is called only when arrays are non-empty — but if Device A's later sync via `syncInspectionAtomic` has any reconciliation hiccup, `reconcileAllChildTables` can soft-delete child rows it can't match. The child-table deletion reconciler in `sync-reconciliation.ts` is the most common cause of "parent intact, kids gone."

#### Confirming with the user's symptoms
- "Only the empty report remained" → parent row preserved, child rows missing → matches V2 + V3
- "On site hours later" → device went offline mid-edit, sync fired on next online, reconciler over-pruned → V3
- The console snippet at the top of this turn already shows IDB timing out at 3s on this exact session, which is the trigger for V2

#### Fix

1. **Form-loader: assert local state on empty server response.** In `InspectionForm.tsx` (and the matching `TrainingForm.tsx`/`DailyAssessmentForm.tsx` loaders), change the `else if (offlineXxx.length > 0)` branches so they actually call `setSystems(offlineSystems)` / `setZiplines(offlineZiplines)` / etc. Today they only log. This is a one-line fix per child type.

2. **Dashboard cache: respect child-row presence.** In `Dashboard.loadInspections` server-cache loop, before calling `saveInspectionOffline(serverParent)`, check whether local has child rows that the server didn't return any update for. If so, **don't bump `synced_at`** — leave the local parent's `synced_at` unchanged so the form loader's `isLocalDataNewer` still wins. Three-line guard added to the existing `shouldPreserveLocalRecord` block.

3. **Sync reconciliation: never auto-prune child rows during a foreign-device sync window.** In `sync-reconciliation.ts`, gate the child-row soft-delete on `inspection.synced_at` being older than the local child rows' `updated_at` *and* the current device being the originator. If another device's sync just touched the parent, defer reconciliation by one cycle. Prevents V3.

4. **IDB-timeout regression:** raise the dashboard's IDB `open` timeout from 3s to 8s on iOS (per the existing 4s read timeout that was already raised). The 3s open is in `offline-storage.ts`. Slow iPad Pros legitimately need 5-6s on cold boot.

5. **Pre-overwrite snapshot.** Already in place via `appendVersion('inspection', ..., 'pre_sync')`. Add a parallel `pre_load_apply` snapshot inside `InspectionForm.loadInspectionData` *before* applying server data, so any future regression is immediately recoverable from the version log.

---

### Cluster B — UI inconsistencies in the screenshots

| Fix | File | Change |
|-----|------|--------|
| Header chip never blank during auth load | `src/components/AuthenticatedHeader.tsx` | Render the chip with a placeholder avatar (initials from cached email) when `currentUser` is still loading, instead of returning `null` |
| Duplicate ForceSyncButton on iPad | `src/components/AuthenticatedHeader.tsx` | The header renders `<ForceSyncButton variant="icon">` for iOS, and the dropdown's `UserProfileDropdown` ALSO renders one inside its trigger row. Remove the header-level duplicate; the dropdown one is sufficient. |
| Email wrap in dropdown | `src/components/UserProfileDropdown.tsx` | Add `break-all text-xs` to the `<DropdownMenuLabel>` containing `currentUser.email`, and constrain dropdown width to `w-72` so longer emails wrap cleanly instead of forcing the panel wider |
| Old version on published site | (no code change) | Resolved by the next **Publish** — v4.6.6 → v4.7.x will deliver the `VersionStatusLine` UI |
| iOS welcome screen crowded by install banners | `src/components/pwa/IOSInstallPromptOnce.tsx` + `src/components/pwa/BackgroundSyncStatus.tsx` | Suppress both on the public welcome route (`/` and `/welcome`). Show them only after sign-in. |

---

### Files to edit

- `src/pages/InspectionForm.tsx` — fix V2 (assert local state on empty server child arrays); add `pre_load_apply` snapshot
- `src/pages/TrainingForm.tsx` — same V2 fix for training child tables
- `src/pages/DailyAssessmentForm.tsx` — same V2 fix
- `src/pages/Dashboard.tsx` — fix Vector 1 (don't bump local `synced_at` if local has unsynced child rows)
- `src/lib/sync-reconciliation.ts` — fix V3 (defer child-row reconciliation when parent was just touched by foreign device)
- `src/lib/offline-storage.ts` — raise IDB `open` timeout from 3s to 8s on iOS
- `src/components/AuthenticatedHeader.tsx` — placeholder chip during auth load; remove duplicate ForceSyncButton
- `src/components/UserProfileDropdown.tsx` — `break-all` on email label, `w-72` panel width
- `src/components/pwa/IOSInstallPromptOnce.tsx` — suppress on public routes
- `src/components/pwa/BackgroundSyncStatus.tsx` — suppress on public routes

No DB migrations. No edge function changes. No new dependencies.

### Verification

1. Two-device test: open same inspection on Device A, edit equipment, close (no sync). Open on Device B (network on). Reopen on A → equipment list intact. ✓
2. Single-device: edit, force-quit Safari mid-save, reopen 1 hour later → form shows last-saved state, not empty shell. ✓
3. Dropdown shows long email wrapped, not clipped. Single sync icon in header. ✓
4. iOS welcome screen no longer covered by install banners. ✓
5. After Publish → published site dropdown shows "PUBLISHED installed v4.7.x — current". ✓

### Risk

- The empty-server-array `setX(offlineX)` change is additive (only fires when local already has data the server doesn't). Worst case: form briefly shows local rows that were legitimately deleted on the server until next sync confirms — but those rows would then be re-deleted by the reconciler. Acceptable tradeoff vs current data-loss bug.
- IDB timeout raise affects only how long cold loads can wait — no functional change to data.
- Header placeholder chip is purely cosmetic.

### Out of scope

- Cross-device QA on real iPhone/iPad/Android (user verifies post-deploy).
- Changing the underlying conflict-resolution model (still LWW + field merge per the existing v7 system).

