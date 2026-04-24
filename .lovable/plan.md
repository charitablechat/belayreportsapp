

## Fix 2.C — Project-wide adoption of a safe `localStorage.setItem` helper + ESLint guard

### Status check

Gap 2.3 already shipped `src/lib/safe-local-storage.ts` exporting `safeSetItem` (and `safeRemoveItem`). It does everything the requested `safeLocalStorageSet` does and more: classifies errors (`quota` / `blocked` / `unknown`), forwards to `logError` for audit visibility, optionally surfaces to the notification center, and supports an `onFail` recovery hook. It also has a passing test suite at `src/lib/__tests__/safe-local-storage.test.ts`.

**Decision:** keep `safeSetItem` as the single helper — do not introduce a second `safeLocalStorageSet` that duplicates it with weaker behavior (toast-only, no audit log, no classification). Adding a parallel helper would split adoption and lose the audit trail. This plan therefore reads as: **finish the project-wide adoption of the existing `safeSetItem` and lock it in with ESLint.**

### What's already adopted

- `src/lib/local-backup-ledger.ts` — both `setItem` sites (Gap 2.3).
- `src/lib/offline-auth.ts` — `queueOfflineSignout` (Gap 2.3).
- `src/hooks/useReportSync.tsx` — `savePendingSyncs` (Gap 2.3).

### What's still missing

A grep of `src/lib/**` and `src/hooks/**` for raw `localStorage.setItem(` will turn up the remaining sites. The ones likely to need conversion based on the file listing:

- `src/hooks/useAutoSync.tsx` — flag writes (e.g. `storage-eviction-warned`) explicitly called out in the request.
- `src/lib/profile-cache.ts` — `persistProfileToLocalStorage` writes `cached_profile_<userId>`.
- `src/lib/photo-receipts.ts` — `savePhotoReceipt`, `markReceiptUploaded`, `removePhotoReceipt` (3 sites).
- `src/lib/sync-logger.ts`, `src/lib/regression-skip-store.ts`, `src/lib/clear-intent.ts`, `src/lib/notification-center.ts`, `src/lib/notification-config.ts`, `src/lib/version-telemetry.ts`, `src/lib/version-policy.ts`, `src/lib/storage-pressure-manager.ts` — likely candidates; will be confirmed by grep.
- A handful of UI-flag writes in hooks: `useNotificationCenter.tsx`, `usePWAUpdate.tsx`, `useStoragePressure.tsx`.

### Explicit do-not-touch list (must stay raw)

These have purpose-built quota handling and will be **excluded** from the sweep + **whitelisted** in ESLint via inline overrides:

- `src/lib/auth-resilience.ts` — pinned + `ensureSpaceForAuth` pre-flight + retry-with-eviction (Phase 3, `mem://auth/phase3-storage-pressure`). Wrapping with `safeSetItem` would conflict with auth-key pinning and re-trigger eviction loops.
- `src/lib/auth-crypto.ts` — encryption-key persistence (Phase 4). Same reason.
- `src/lib/safe-local-storage.ts` itself — the helper.
- `src/lib/idb-migration-safety.ts` audit log writes that intentionally bypass app helpers during migration boot (Phase 5). Will reconfirm during implementation; if they're plain writes, they get wrapped.

### Plan

#### 1. Sweep remaining `localStorage.setItem` sites under `src/lib/**` and `src/hooks/**`

For each non-excluded file, replace `localStorage.setItem(key, value)` with `safeSetItem(key, value, { scope: '<file>.<operation>', critical: false })`. The default `critical: false` is correct for these — they're caches, debounce flags, telemetry counters, and receipts; their loss is annoying but not user-data-loss-class. The two existing `critical: true` call sites (backup ledger unsynced-snapshot writes) stay as-is.

Specific notes per file:
- **`profile-cache.ts`** — wrap `persistProfileToLocalStorage`. Scope `'profile-cache.persist'`. Loss is fine; profile re-fetches on next online sign-in.
- **`photo-receipts.ts`** — wrap all 3 sites. Scope `'photo-receipts.save'` / `'photo-receipts.markUploaded'` / `'photo-receipts.remove'`. Loss means we can't detect photo blob loss — annoying but not catastrophic.
- **`useAutoSync.tsx`** flag writes — scope `'auto-sync.flag'`. Loss means the user sees an extra notification once.
- All other hits — scope `'<module>.<purpose>'`, `critical: false`. No `onFail` hooks needed.

No call sites change behavior other than gaining an audit-log entry on failure.

#### 2. ESLint guard — `no-restricted-syntax`

Update `eslint.config.js` with a rule that bans raw `localStorage.setItem(...)` calls inside `src/lib/**` and `src/hooks/**`, with a clear error message pointing to `safe-local-storage.ts`.

Approach: add a new flat-config block scoped to `files: ['src/lib/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}']` with:

```js
'no-restricted-syntax': ['error', {
  selector: "CallExpression[callee.object.name='localStorage'][callee.property.name='setItem']",
  message: "Use safeSetItem from '@/lib/safe-local-storage' instead of localStorage.setItem. See mem://architecture/storage-pressure-eviction.",
}]
```

Then add a second block that **overrides this rule back to `'off'`** for the explicit allow-list:

```js
{
  files: [
    'src/lib/safe-local-storage.ts',
    'src/lib/auth-resilience.ts',
    'src/lib/auth-crypto.ts',
    // any idb-migration-safety.ts entries confirmed during implementation
  ],
  rules: { 'no-restricted-syntax': 'off' },
}
```

This pins adoption going forward — any new `localStorage.setItem` outside the allow-list fails CI lint.

`src/components/**`, `src/pages/**`, and tests are intentionally **not** scoped by the rule. Components rarely write directly to `localStorage`; if they do, it's almost always a UI-only flag where the existing inline `try/catch` pattern is fine. Forcing every component to import `safeSetItem` creates more churn than value. This can be tightened in a follow-up if it becomes a problem.

#### 3. Documentation

Add a one-line note at the top of `src/lib/safe-local-storage.ts` reaffirming the convention and listing the ESLint-whitelisted files, so a future reader understands why those exceptions exist.

Update `mem://architecture/storage-pressure-eviction` with the new convention sentence: "All `src/lib/**` and `src/hooks/**` writes go through `safeSetItem` (enforced by ESLint). Auth-credential and encryption-key writes are exempt — see Phase 3/4 memory."

#### 4. No new tests

The helper is already tested. The sweep is mechanical. Adding tests per call site adds noise without coverage value. The ESLint rule is its own enforcement.

### Out of scope

- No new helper module — `safeSetItem` already exists and is strictly more capable than the requested `safeLocalStorageSet`.
- No sweep of `src/components/**` or `src/pages/**` — keeps blast radius small. Future tightening is a follow-up.
- No `safeLocalStorageGet` — reads don't throw on quota; `getItem` only fails on `SecurityError` (private mode), which is already handled by the existing `try { return JSON.parse(localStorage.getItem(...) ...) } catch { return null }` pattern everywhere it matters.
- No changes to `auth-resilience.ts`, `auth-crypto.ts`, or migration-snapshot writes.
- No CI workflow changes — the existing lint step picks up the new rule automatically.

### Files touched

1. **`eslint.config.js`** — new `no-restricted-syntax` rule + targeted overrides for the allow-list.
2. **`src/lib/safe-local-storage.ts`** — header comment refresh listing the whitelisted files.
3. **`src/hooks/useAutoSync.tsx`** — flag-write swaps.
4. **`src/lib/profile-cache.ts`** — wrap `persistProfileToLocalStorage`.
5. **`src/lib/photo-receipts.ts`** — wrap 3 sites.
6. **Other `src/lib/**` and `src/hooks/**` files identified by grep during implementation** — same mechanical swap, scope-named per file.
7. **`mem://architecture/storage-pressure-eviction.md`** — append the new convention sentence.

