

# Run Zero-Data-Loss Test Suite

## What Will Be Executed

Run all existing unit tests across the three test files that verify the Zero Data Loss Architecture guards:

1. **`src/lib/local-data-guards.test.ts`** (10 tests) -- the newly added `isLocalDataNewer` guard tests
2. **`src/lib/offline-storage-guards.test.ts`** (12 tests) -- empty-array save guards and temp-ID restriction guards
3. **`src/lib/sw-sync-validators.test.ts`** (6 tests) -- service worker sync validation and `shouldSkipUpsert` guards

**Total: 28 tests** covering all critical data integrity safeguards.

## Technical Details

Run via Vitest using the existing configuration. No file changes required -- this is a verification-only step.

