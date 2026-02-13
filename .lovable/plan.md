
# Add Unit Test for `localIsNewer` Guard Logic

## Overview

Extract the `localIsNewer` determination logic from `InspectionForm.tsx` into a testable pure function, then write unit tests covering all scenarios.

## Changes

### 1. New file: `src/lib/local-data-guards.ts`

Extract the guard logic into a reusable pure function:

```typescript
export function isLocalDataNewer(
  offlineData: { updated_at?: string | null; synced_at?: string | null } | null | undefined,
  serverData: { updated_at?: string | null } | null | undefined
): boolean {
  if (!offlineData) return false;
  if (!offlineData.synced_at) return true; // Never synced = local has unsynced changes
  return !!(
    offlineData.updated_at &&
    serverData?.updated_at &&
    new Date(offlineData.updated_at) > new Date(serverData.updated_at)
  );
}
```

### 2. New file: `src/lib/local-data-guards.test.ts`

Test cases:

| Scenario | offlineData | serverData | Expected |
|----------|------------|------------|----------|
| No offline data | `null` | any | `false` |
| Offline never synced (no `synced_at`) | `{ updated_at: "...", synced_at: null }` | any | `true` |
| Local `updated_at` newer than server | `{ updated_at: "2025-01-02", synced_at: "2025-01-01" }` | `{ updated_at: "2025-01-01" }` | `true` |
| Server `updated_at` newer than local | `{ updated_at: "2025-01-01", synced_at: "2025-01-01" }` | `{ updated_at: "2025-01-02" }` | `false` |
| Equal timestamps | same timestamps | same timestamps | `false` |
| Server data is null | has data | `null` | `false` |

### 3. Update `src/pages/InspectionForm.tsx`

Replace inline logic at line 913-917 with a call to `isLocalDataNewer(offlineData, data)`. Same import can be used by `TrainingForm.tsx` and `DailyAssessmentForm.tsx` for consistency, but that is optional scope.

## Technical Notes

- No new dependencies needed
- Tests will run via existing Vitest setup
- The extraction is a pure refactor with no behavioral change
