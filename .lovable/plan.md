

## P4 — SYNC_DRIFT_TOLERANCE_MS override

Already shipped. Verified in `src/lib/local-data-guards.ts`:

- `exceedsDriftTolerance(aMs, bMs, toleranceMs = SYNC_DRIFT_TOLERANCE_MS)` accepts an optional override.
- `isUpdatedAheadOfSync(updatedMs, syncedMs, toleranceMs = SYNC_DRIFT_TOLERANCE_MS)` accepts an optional override.
- Production callers omit the third arg and inherit the 30s constant.
- Test coverage exists in `src/lib/__tests__/drift-tolerance-override.test.ts` exercising tolerance=0 and custom values, plus boundary tests in `src/lib/local-data-guards.test.ts`.

No code changes needed.

