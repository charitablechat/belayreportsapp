

## Phase 4 — Correctness Bugs (Versioning, Hooks, Race Conditions)

Four findings, ~9 files touched. No DB migrations.

---

### H4 — Drop the rollover scheme so `version-calculator.ts` stops fighting `vite-auto-version.ts`

**Problem:** `version-calculator.ts` clamps PATCH and MINOR to 1–9 with rollover (e.g. `2.3.9 → 2.4.1`), but the active build pipeline in `vite-auto-version.ts` writes the *full git commit count* as PATCH (e.g. `4.7.142`). The two schemes are incompatible — the calculator would reject every real build as invalid.

**Fix:**
- In `src/lib/version-calculator.ts`: remove `getNextVersion`, `calculateNextVersion`, `generateVersionSequence`, and `isValidSchemeVersion`. Keep `parseVersion`, `formatVersion`, and the `Version` type — they're still useful for parsing/formatting.
- Update `src/lib/version-calculator.test.ts` to drop the deleted-function suites; keep `parseVersion` and `formatVersion` tests.
- In `vite.config.ts` (lines 7–13): replace the rollover comment block with a one-liner pointing to `vite-auto-version.ts` as the canonical source.
- **Audit `APP_VERSION` consumers:** verified that `attestation.ts`, `version-telemetry.ts`, `version-check.ts`, and `MinVersionEnforcer.tsx` all read `APP_VERSION` as an opaque string and never call any rollover helper. Stamps are unaffected. Existing attestation records with old version strings keep working — comparison is string-based via `isVersionNewer` which already handles SemVer correctly.

---

### H5 — Move the unsaved-changes guard *inside* the Realtime UPDATE handler

**Problem:** All three form pages (`InspectionForm`, `TrainingForm`, `DailyAssessmentForm`) include `hasUnsavedChanges` in the Realtime effect deps. Every keystroke flips that flag, causing `supabase.removeChannel` + `supabase.channel(...).subscribe()` to churn — wasteful, and creates a brief window where remote updates are missed.

**Fix (applied identically to all three files):**
- Replace the `hasUnsavedChanges` state read inside the handler with a ref read: `hasUnsavedRef.current` (already exists in all three components; verified).
- Drop `hasUnsavedChanges` from the effect deps array. Final deps: `[id, loadInspection]` (or equivalent loader for the other two).
- Drop `inspection?.updated_at` / `training?.updated_at` / `assessment?.updated_at` from deps too, and read those via a ref pattern as well — same churn problem at lower frequency. Add `lastLoadedUpdatedAtRef` updated by the loader functions.
- Keep the `eslint-disable-next-line react-hooks/exhaustive-deps` comment.

Files: `src/pages/InspectionForm.tsx` (lines 517–542), `src/pages/TrainingForm.tsx` (lines 601–626), `src/pages/DailyAssessmentForm.tsx` (lines 379–404).

---

### H6 — Single-flight lock around session refresh + abort on sign-out

**Problem:** `cached-auth.ts` calls `supabase.auth.refreshSession()` from at least four sites (lines 203, 631, 683, 714) without coordination. Concurrent refreshes race the Supabase auth-js LockManager and can cause the documented "LockManager timeout" fallback path. On sign-out, an in-flight refresh can also re-hydrate the session moments after `signOut()` clears it.

**Fix:**
- Add module-level `let pendingRefreshPromise: Promise<...> | null = null;` and `let refreshAborted = false;`.
- New helper `refreshSessionSingleFlight()` that:
  - Returns the existing `pendingRefreshPromise` if one is in flight.
  - Otherwise calls `supabase.auth.refreshSession()`, stores the promise, clears it in `finally`.
  - Checks `refreshAborted` before resolving — if true, treat as no-op (return null).
- Replace all four direct `supabase.auth.refreshSession()` call sites with `refreshSessionSingleFlight()`.
- New exported `signOutWithAbort()` helper:
  - Sets `refreshAborted = true`.
  - Awaits any `pendingRefreshPromise` with a short timeout (don't deadlock on a hung refresh).
  - Calls `supabase.auth.signOut()`.
  - Resets `refreshAborted = false`.
- Wire `signOutWithAbort` into the existing online sign-out paths (`Dashboard.tsx`, `AuthenticatedHeader.tsx`) — these currently call `supabase.auth.signOut()` directly. Offline sign-out path (Phase 2) is unaffected; it never refreshes.

---

### H10 (critical subset) — Fix the 3 hooks errors + 1 unsafe optional-chaining

**`src/components/dev/OfflineSimulator.tsx`** (3 errors):
The component returns `null` at line 15 (`if (!import.meta.env.DEV) return null;`) BEFORE the three `useEffect` hooks. Hooks must be called unconditionally.
- Fix: move the `if (!import.meta.env.DEV) return null;` check to AFTER all three `useEffect` calls (just before the JSX `return`). Hooks then run in the same order on every render; production builds still render `null` as today. The component body is currently a stub (lines 87–94 render mostly empty divs), so this is a pure correctness fix.

**`src/pages/Capabilities.tsx:47`** (1 unsafe optional-chaining + 1 `any`):
```ts
supported: 'sync' in (navigator as any).serviceWorker?.register || false,
```
If `serviceWorker` is undefined, `serviceWorker?.register` short-circuits to `undefined`, then `'sync' in undefined` throws `TypeError`.
- Fix: `supported: 'serviceWorker' in navigator && 'SyncManager' in window`. This matches how the actual feature is detected elsewhere and avoids both the optional-chaining trap and the `any` cast.

**Deferred (not in this phase):** the 42 `react-hooks/exhaustive-deps` warnings and 983 `@typescript-eslint/no-explicit-any` warnings. Captured as known cleanup work.

---

### Files touched (summary)

- `src/lib/version-calculator.ts` — strip rollover helpers, keep parse/format
- `src/lib/version-calculator.test.ts` — drop deleted-function suites
- `vite.config.ts` — comment cleanup
- `src/pages/InspectionForm.tsx` — Realtime deps fix (H5)
- `src/pages/TrainingForm.tsx` — Realtime deps fix (H5)
- `src/pages/DailyAssessmentForm.tsx` — Realtime deps fix (H5)
- `src/lib/cached-auth.ts` — single-flight refresh + abort-on-signout (H6)
- `src/pages/Dashboard.tsx` — call `signOutWithAbort()` instead of `supabase.auth.signOut()`
- `src/components/AuthenticatedHeader.tsx` — same
- `src/components/dev/OfflineSimulator.tsx` — hooks ordering (H10)
- `src/pages/Capabilities.tsx` — replace unsafe `?.` with proper feature check (H10)

No DB migrations. No new secrets. No edge-function changes.

---

### Risk

- **H4**: Low. The deleted helpers were unused outside their test file and a stale comment in `vite.config.ts`. Existing attestation records remain valid (string-stored).
- **H5**: Low. Moving `hasUnsavedChanges` from deps to a ref read inside the handler preserves the suppress-during-typing behavior with no churn. Tested pattern — `hasUnsavedRef` already exists in all three forms.
- **H6**: Medium. The single-flight refactor touches a hot path. Mitigated by keeping each call site's behavior identical — only the underlying coordination changes. Sign-out abort uses a short timeout (1s) so a hung refresh can't block sign-out.
- **H10**: Low. Both fixes are mechanical — moving a return statement and replacing an unsafe expression with a documented feature check.

---

### Verification

1. `npm run lint` reports 0 errors (warnings unchanged). The 4 specific errors disappear.
2. Type a long burst into an Inspection form while a second device pushes an UPDATE → the form does not flicker, no `removeChannel`/`subscribe` log spam in the console (`[InspectionForm] Skipping remote refresh` still fires once per remote update during typing).
3. Sign out while offline simulator is enabled → no LockManager warnings, no "session re-hydrated after signout" toast.
4. `npm test` passes; `version-calculator.test.ts` covers the surviving `parseVersion`/`formatVersion` cases.
5. Build a fresh deploy → `/version.json` shows `4.7.<commits>` exactly as before; `APP_VERSION` in attestation stamps matches.
6. `OfflineSimulator` renders nothing in production builds and the same minimal stub in dev builds (no behavioral change).
7. `/capabilities` page loads with no runtime errors on a browser without `serviceWorker`.

