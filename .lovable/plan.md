

# Automated Tests for Zero Data Loss Guards

## Overview

Create two test files that validate the safety guards implemented in the Zero Data Loss Strategy. These are pure logic/unit tests that don't require browser or IndexedDB -- they test the guard conditions (empty-array blocking and temp-ID restrictions) by extracting and testing the guard logic directly.

## Test Files to Create

### 1. `src/lib/offline-storage-guards.test.ts`

Tests the three categories of safety guards in `offline-storage.ts`:

**Empty-Array Guards (6 tests)**
- `saveRelatedDataOffline` returns early when called with empty array (for each of: systems, ziplines, equipment, standards, summary)
- `saveAssessmentDataOffline` returns early when called with empty array
- `saveTrainingDataOffline` returns early when called with empty array

**Temp-ID Restriction Guards (6 tests)**
- `clearRelatedDataOffline` blocks when called with a permanent UUID
- `clearRelatedDataOffline` allows when called with a `temp-` prefixed ID
- `clearAssessmentDataOffline` blocks on permanent UUID
- `clearAssessmentDataOffline` allows on `temp-` ID
- `clearTrainingDataOffline` blocks on permanent UUID
- `clearTrainingDataOffline` allows on `temp-` ID

**Approach**: Since these functions depend on IndexedDB (via `idb` library), the tests will mock the `idb` module's `openDB` to provide a fake database. The key assertion is that when the guard condition is met (empty array or non-temp ID), the `openDB` function is **never called** -- proving the function returned early before touching storage.

### 2. `src/lib/sw-sync-guards.test.ts`

Tests the service worker upsert logic by extracting the guard functions (`validateInspectionData` and the empty-array check in `upsertRelatedData`) and testing them in isolation.

**Validation Tests (5 tests)**
- Returns invalid when inspection missing required fields
- Returns valid with complete data
- Returns invalid for systems missing required fields
- Returns invalid for equipment missing required fields
- Returns valid with empty child arrays (allowed -- just means nothing to validate)

**Upsert Empty-Array Guard Tests (3 tests)**
- `upsertRelatedData` skips fetch when data is `null`
- `upsertRelatedData` skips fetch when data is empty array `[]`
- `upsertRelatedData` calls fetch when data has items

**Approach**: Since `sw-sync.js` is a service worker file (not a module), we'll re-implement the pure guard functions in a small testable helper file `src/lib/sw-sync-validators.ts` that mirrors the exact logic, then test that. This avoids the complexity of loading service worker globals in a vitest environment.

## Setup Required

### New file: `vitest.config.ts`
Standard vitest config with `jsdom` environment and path aliases matching the project.

### New file: `src/test/setup.ts`  
Minimal test setup with `@testing-library/jest-dom` import and `matchMedia` mock.

### Update: `tsconfig.app.json`
Add `"vitest/globals"` to the `types` array.

## Files to Create/Modify

| File | Action |
|------|--------|
| `vitest.config.ts` | Create -- vitest configuration |
| `src/test/setup.ts` | Create -- test setup file |
| `src/lib/sw-sync-validators.ts` | Create -- extracted pure validation functions from sw-sync.js |
| `src/lib/offline-storage-guards.test.ts` | Create -- 12 tests for empty-array and temp-ID guards |
| `src/lib/sw-sync-guards.test.ts` | Create -- 8 tests for upsert and validation guards |
| `tsconfig.app.json` | Update -- add vitest/globals type |

## Technical Details

The tests use `vi.mock()` to mock the `idb` module, preventing any real IndexedDB access. The core assertion pattern is:

```typescript
// Mock idb so we can detect if openDB was called
vi.mock('idb', () => ({ openDB: vi.fn() }));

it('blocks save of empty array', async () => {
  const { openDB } = await import('idb');
  await saveRelatedDataOffline('systems', 'some-uuid', []);
  // Guard should have returned early -- openDB never called
  expect(openDB).not.toHaveBeenCalled();
});
```

For the service worker validators, the pattern tests pure functions directly:

```typescript
it('returns invalid when inspection missing fields', () => {
  const result = validateInspectionData(
    { id: null, organization: '', location: '' },
    [], [], [], [], null
  );
  expect(result.valid).toBe(false);
});
```

