

## Comprehensive debugging pass — status check

Walking each item in your TL;DR against the current `main` and the memories logged from prior fixes.

### C1 — boolean-keyed `by-uploaded` index
**Already shipped.** Verified earlier this session:
- `savePhotoOffline` and `markPhotoAsUploaded` funnel every write through `toUploadedFlag()` → `0 | 1`.
- v16 schema migration rewrites legacy boolean rows; v18 re-runs the coercion using the wrapped `IDBPObjectStore` for slow devices. `DB_VERSION = 18`, `public/db-config.js` matches.
- Schema typed as `'by-uploaded': number`.
- Two contract tests against `fake-indexeddb`: `photos-by-uploaded-contract.test.ts` (5 cases incl. v15→v16 migration) and `photo-uploaded-index.test.ts`.
- Memory: `mem://constraints/photos-uploaded-index`.

The audit's `debug-c1-boolean-index.mjs` reproduction would have been red against the *pre-fix* code; against current `main` the regression tests already cover the exact scenarios. **Closed.**

### #3 — Service-worker DB version mismatch
**Already shipped.** Current state:
- `vite-pwa-config.ts` line 35: `importScripts: ['/db-config.js', '/sw-push.js', '/sw-sync.js']` — `db-config.js` is now wired in.
- `vite-db-version-check.ts` (build-time plugin in `vite.config.ts`) fails the build if `public/db-config.js` and `src/lib/offline-storage.ts` declare different versions. Both currently `v18`.
- Memory: `mem://architecture/pwa-update-system`.

The audit cited `DB_VERSION = 15` and `importScripts: ['/sw-push.js', '/sw-sync.js']` — that's stale main. Current main has both fixed plus a build-time tripwire. The only minor remaining hardening would be removing the silent `|| 9` fallback in `public/sw-sync.js`, but with the build-time parity check that fallback is now dead code. **Closed.**

### C4 — T0-snapshot overwrite
**Confirmed fixed.** Audit and codebase agree — `safePostSyncSave` covers all six call sites. **Closed.**

### C2 — `getUnsyncedCounts` silent boundary
**Already shipped.** The batched `getUnsyncedCounts` was deleted earlier. `useAutoSync.updateUnsyncedCounts` now calls `getUnsyncedInspections`, `getUnsyncedTrainings`, `getUnsyncedDailyAssessments` in parallel via `Promise.all`, each returning `IdbReadFailure` through `withIndexedDBReadBoundary`. Memory: `mem://architecture/unsynced-counts-coalescer`.

The audit's `debug-c2-silent-boundary.mjs` exercises a function that no longer exists in main. **Closed.**

### C5 — `isUnsafeToTransmit` unused
**Open. Real.** This is the one item I want to confirm with a read before planning the fix. If still 0 callers, the fix is the Supabase-client `fetch` wrapper from your audit (Option 1) — small, contained, defense-in-depth. Option 2 (storage-adapter filter) risks breaking the trust-then-verify offline auth path (`mem://auth/offline-sign-in-system`) which intentionally relies on `supabase.auth.getSession()` returning the placeholder session for the OFFLINE_AUTHENTICATED state machine to function. **Recommend Option 1 only.**

### N1 — vitest exits 1 on green suite
**Open. Real and worth fixing.** Audit's preferred fix (defer `localStorage` access in `src/integrations/supabase/client.ts`) is blocked by the file's "DO NOT EDIT — auto-generated" rule (enforced in our system prompt). So the only viable fix is the audit's option 1: refactor so `safe-local-storage.test.ts`'s subject doesn't transitively import the supabase client. Practically that means asserting `safeLocalStorage` lives in a leaf module with no `@/integrations/supabase` import chain — needs a quick dep-graph read to confirm what's pulling it in.

### Plan — what to actually do

1. **Read-only confirmation pass (one batch, no writes):**
   - `grep -rn 'isUnsafeToTransmit' src/` to confirm 0 callers.
   - `code--view src/lib/safe-local-storage.ts` + the test file to find the import chain that's pulling in the supabase client at module load.
   - Spot-check `vite-pwa-config.ts` and `public/sw-sync.js` to confirm `#3` fallback line.

2. **C5 fix — wire `isUnsafeToTransmit` into a Supabase fetch wrapper.** Since `src/integrations/supabase/client.ts` is off-limits, create a `src/lib/supabase-fetch-guard.ts` that exports a wrapped `fetch` and a small init helper. **Then ask the user** whether to:
   - (a) Document the wrapper and have the user paste one line into `client.ts`, or
   - (b) Wrap at every transmit boundary we control (`atomic-sync-manager.ts` already has `assertRealSessionForSync`; we'd add `assertHeaderSafe` to the small set of `supabase.functions.invoke` and direct `fetch` call sites).
   
   Option (b) is the only path that doesn't require touching the auto-generated client. Recommend (b).

3. **N1 fix — break the import chain.** Refactor `safe-local-storage.ts` and its tests so the test file imports only leaf modules. No supabase imports in the dep graph of the test subject. Add a vitest config `onConsoleLog` rule that fails the run if `localStorage is not defined` shows up post-teardown, so this regresses loudly next time.

4. **Memory updates after each fix:**
   - C5: add `mem://security/supabase-transmit-guard` documenting which boundaries call `assertHeaderSafe` and why `client.ts` can't host the wrapper.
   - N1: add note to `mem://architecture/sync-boundary-test-coverage` about the dep-graph isolation rule for `safe-local-storage` tests.

5. **No-op / closed items.** I'll add a one-line note to the existing memories for C1, C2, #3, C4 referencing this audit so the next pass doesn't re-flag them. Stale audit notes are the main driver of churn here.

### Out of scope this round
- H1, H3, H5, H6 partial coverage, M-eslint count growth — all real, all pre-existing, all flagged as accepted-debt or scoped for separate passes.
- The three `verify_jwt = false` edge functions — explicitly deferred per prior turn (`mem://security/system-orchestration-auth-bypass` documents the design intent).

### Verdict

- **Closed (already shipped, audit ran against stale main):** C1, C2, #3, C4.
- **Open, fix this round:** C5 (wire `isUnsafeToTransmit` at transmit boundaries we control, recommend Option (b) since `client.ts` is auto-generated), N1 (break the supabase import chain in `safe-local-storage` test deps).
- **Out of scope this round:** H1, H3, H5, H6, M-eslint, edge-function `verify_jwt=false`.

Approve and I'll switch to default mode, run the three confirmation reads, then ship C5 and N1.

