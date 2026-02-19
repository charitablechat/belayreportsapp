

# Fix: Data Recovery Tool -- Remaining Crash Vectors

## Diagnostic Summary

The previous fix (wrapping `getQueued*` in `withIndexedDBErrorBoundary` + 10s timeout) solved the **async** crash path. However, three **synchronous** crash vectors remain, plus there is no React Error Boundary to catch render-time explosions.

## Crash Vector 1: `listAllSnapshots()` and `getBackupStorageInfo()` -- Unprotected localStorage Access

**File:** `src/lib/local-backup-ledger.ts` (lines 187, 282)

Both functions iterate over `localStorage` with raw calls to `localStorage.length` and `localStorage.key(i)`. While there are inner try/catch blocks for JSON.parse, the **outer loop itself** is unprotected. In environments where localStorage is restricted (private browsing on some mobile browsers, storage disabled, SecurityError), these calls throw synchronously during React render, crashing the component tree.

```
// Current code (line 187) -- no outer try/catch:
for (let i = 0; i < localStorage.length; i++) {  // <-- can throw SecurityError
  const key = localStorage.key(i);                // <-- can throw
```

**Fix:** Wrap each function's body in a top-level try/catch that returns safe defaults (`[]` for `listAllSnapshots`, zeroed object for `getBackupStorageInfo`).

## Crash Vector 2: `getAgeBadge()` -- Invalid Timestamps

**File:** `src/components/admin/DataRecoveryTool.tsx` (line 263)

`getAgeBadge` calls `formatDistanceToNow(new Date(timestamp))`. If a queued operation has an undefined or non-numeric `timestamp`, `new Date(undefined)` produces an Invalid Date, and `formatDistanceToNow` throws a `RangeError`. This crashes the render of the Queued Ops tab.

**Fix:** Guard with a validity check; if timestamp is falsy or produces an invalid date, return a static "Unknown age" badge instead of calling `formatDistanceToNow`.

## Crash Vector 3: No React Error Boundary

**Files:** `src/components/admin/DataRecoveryTool.tsx`, `src/components/UserDataRecoverySheet.tsx`

Currently, if **any** of the above throws during render, the entire Admin tab (or user recovery sheet) white-screens with no recovery option. There is no React Error Boundary anywhere in the component tree above these panels.

**Fix:** Create a lightweight `RecoveryErrorBoundary` component that catches render errors and displays a "failed to load" fallback with a Retry button, scoped to each panel independently. This means if `LocalSnapshotsPanel` crashes, `IndexedDBRecoveryPanel` still renders (and vice versa).

## Files Modified

| File | Change |
|------|--------|
| `src/lib/local-backup-ledger.ts` | Add top-level try/catch to `listAllSnapshots()` and `getBackupStorageInfo()` |
| `src/components/admin/DataRecoveryTool.tsx` | Guard `getAgeBadge` against invalid timestamps; add `RecoveryErrorBoundary` wrapper around each panel |
| `src/components/UserDataRecoverySheet.tsx` | Wrap panels in `RecoveryErrorBoundary` |

## What This Does NOT Change

- No data safety protocols are modified
- No persistence, sync, backup, or WAL logic is touched
- The `withIndexedDBErrorBoundary` wrappers from the previous fix remain intact
- All existing RLS policies, access controls, and encryption are untouched
- The Error Boundary only catches render errors -- it does not suppress or swallow data operations

## Technical Details

### local-backup-ledger.ts changes

```typescript
// listAllSnapshots -- wrap entire body
export function listAllSnapshots() {
  try {
    // ... existing localStorage iteration logic unchanged ...
  } catch (error) {
    console.error('[Backup Ledger] Failed to list snapshots:', error);
    return [];
  }
}

// getBackupStorageInfo -- wrap entire body
export function getBackupStorageInfo() {
  try {
    // ... existing logic unchanged ...
  } catch (error) {
    console.error('[Backup Ledger] Failed to get storage info:', error);
    return { totalBytes: 0, snapshotCount: 0, unsyncedCount: 0 };
  }
}
```

### getAgeBadge guard

```typescript
const getAgeBadge = (timestamp: number) => {
  if (!timestamp || isNaN(timestamp)) {
    return <Badge variant="outline">Unknown age</Badge>;
  }
  try {
    const ageMs = Date.now() - timestamp;
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageLabel = formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    // ... existing color logic ...
  } catch {
    return <Badge variant="outline">Unknown age</Badge>;
  }
};
```

### RecoveryErrorBoundary (class component in DataRecoveryTool.tsx)

A minimal React class component with `componentDidCatch` that:
- Logs the error to console
- Renders a Card with an AlertTriangle icon, "This section failed to load" message, and a "Retry" button that resets the error state
- Used to wrap `LocalSnapshotsPanel` and `IndexedDBRecoveryPanel` independently in both `DataRecoveryTool` and `UserDataRecoverySheet`

