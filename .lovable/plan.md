

## S37 — Remove unused `CLOCK_SKEW_TOLERANCE_MS` alias

### Finding

`src/lib/local-data-guards.ts` exports `SYNC_DRIFT_TOLERANCE_MS` as the canonical name. A repo-wide grep for `CLOCK_SKEW_TOLERANCE_MS` is needed to confirm zero callers — the user's ref hints it was kept "just in case" and is now unused.

If confirmed unused, the alias is pure dead code: removing it can only convert a (currently impossible) runtime use into a TS compile error, strictly safer.

### Fix

In `src/lib/local-data-guards.ts`, delete the `CLOCK_SKEW_TOLERANCE_MS` re-export line (around L46–50, per the user's reference). Leave `SYNC_DRIFT_TOLERANCE_MS`, `exceedsDriftTolerance`, `isUpdatedAheadOfSync`, `isLocalDataNewer`, and `shouldPreserveLocalRecord` untouched.

If grep turns up any caller still importing the old name, switch that caller to `SYNC_DRIFT_TOLERANCE_MS` in the same change.

### Out of scope

- Renaming or restructuring `local-data-guards.ts`.
- Touching the drift tolerance value or any guard logic.

### Risk

None. Pure dead-code removal, gated on grep confirmation.

### Verification

- Pre-edit: `grep -r "CLOCK_SKEW_TOLERANCE_MS" src/` returns only the declaration line.
- `npx tsc --noEmit` passes post-edit.
- Existing tests in `src/lib/local-data-guards.test.ts` still pass.

