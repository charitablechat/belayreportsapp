

# Fix: IndexedDB Recovery Panel Crash on Initial Render

## Root Cause

The `IndexedDBRecoveryPanel` component has a render guard on line 564:

```typescript
if (loading && !localData) {
  return <LoadingSpinner />;
}
```

This guard requires **both** `loading === true` AND `localData === null` to show the loading state. But on the very first render:
- `loading` = `false` (initial `useState` value)
- `localData` = `null` (initial `useState` value)

Since `loading` is `false`, the guard is skipped. The component attempts to render the full UI, which includes non-null assertions like `localData!.queuedOperations` (lines 1012, 1068, 1125) in the Queued Ops tab's checkbox logic. This crashes with `Cannot read properties of null`.

The `useEffect` that calls `loadLocalData()` runs **after** the first render, so data loading hasn't even started yet when the crash occurs.

## Fix

**File: `src/components/admin/DataRecoveryTool.tsx`**

One-line change -- update the guard condition from `loading && !localData` to just `!localData`:

```typescript
// Before (line 564):
if (loading && !localData) {

// After:
if (!localData) {
```

This ensures the loading/empty state is shown whenever `localData` hasn't been populated yet, regardless of the `loading` flag. Once `loadLocalData` completes (success or failure), it always sets `localData` to either real data or empty arrays, so the full UI only renders when it's safe.

## What This Does NOT Change

- No data safety protocols are modified
- No IndexedDB error boundaries or circuit breaker logic is touched
- No persistence, sync, backup, or WAL logic is affected
- The `RecoveryErrorBoundary` wrapper remains as a safety net for any future render errors
- All existing RLS policies and access controls are untouched

## Why the Error Boundary Catches It

The `RecoveryErrorBoundary` wrapping `IndexedDBRecoveryPanel` correctly catches this synchronous render crash and shows "This section failed to load." Clicking "Retry" resets the boundary, which remounts the component -- but the same crash happens again on the fresh first render, creating an infinite crash loop.

