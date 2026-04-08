

# Fix: "Update check failed" Toast on PWA Update Check

## Root Cause

In `usePWAUpdate.tsx`, the `checkForUpdates` function wraps `reg.update()` with a 4-second timeout. When the SW update call is slow (common on mobile or slower connections), the timeout fires and sets `updateCallError`. Later, the code checks this error and returns `'error'` — even though there's nothing actually wrong; the update call was just slow and no update exists.

The flow:
1. `updatePromise` resolves `false` after 4s (no `updatefound` event)
2. `await updateCallPromise` — this already caught a timeout error, setting `updateCallError`
3. Line 239: `if (updateCallError)` → returns `'error'`
4. ManualUpdateButton shows "Update check failed" toast

A timeout on `reg.update()` when no update was found is not an error — it just means the check was slow and there's nothing new.

## Fix

### `src/hooks/usePWAUpdate.tsx`

Change the error-handling logic (lines 239-242) to distinguish timeout errors from real failures. If `updateCallError` is a timeout and no update was found, treat it as `'up_to_date'` instead of `'error'`:

```tsx
if (updateCallError) {
  // Timeout on reg.update() with no update found is not an error
  const isTimeout = updateCallError instanceof Error && 
    updateCallError.message.includes('timeout');
  if (!isTimeout) {
    console.error('[PWA Update] Check failed:', updateCallError);
    return 'error';
  }
  // Timeout with no update found = up to date
}

return 'up_to_date';
```

This is a single change in one file. The `'error'` toast will only show for genuine failures (network errors, SW registration issues), not for slow-but-successful checks.

### Files Modified
- `src/hooks/usePWAUpdate.tsx` — treat timeout as up_to_date, not error

