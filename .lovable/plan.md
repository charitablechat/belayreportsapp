

# Fix Dashboard Orphan Cleanup and Dead Code

## Problem

Two issues identified in the previous audit:

1. **Data Loss Risk**: The orphan cleanup loops in `Dashboard.tsx` delete any local record not found on the server. This includes `temp-` ID records that haven't synced yet -- meaning unsynced offline reports can be silently destroyed when the dashboard refreshes.

2. **Dead Code**: Lines 552-554 contain an `if (navigator.onLine)` check inside a branch already gated by `!navigator.onLine`, making it unreachable.

## Changes

### 1. Guard orphan cleanup loops against temp-IDs (3 locations)

**File: `src/pages/Dashboard.tsx`**

Add `&& !local.id.startsWith('temp-')` to all three orphan cleanup conditions:

**Inspections (line 389):**
```typescript
if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
```

**Trainings (line 480):**
```typescript
if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
```

**Daily Assessments (line 574):**
```typescript
if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
```

### 2. Remove dead code block (lines 552-554)

**File: `src/pages/Dashboard.tsx`**

Remove the unreachable `if (navigator.onLine) { setLoading(false); }` block inside the `!navigator.onLine` branch.

## Summary

| Location | Change |
|----------|--------|
| `Dashboard.tsx` line 389 | Add temp-ID guard to inspection orphan cleanup |
| `Dashboard.tsx` line 480 | Add temp-ID guard to training orphan cleanup |
| `Dashboard.tsx` line 574 | Add temp-ID guard to assessment orphan cleanup |
| `Dashboard.tsx` lines 552-554 | Remove dead code |

