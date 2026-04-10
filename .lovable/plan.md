

# Fix: Photo Upload Stuck on Spinner & User Trapped in App

## Root Cause Analysis

The console logs reveal IndexedDB is completely broken in the user's session: **114 operation timeouts** and "IndexedDB open timed out after 3s." This causes two cascading failures:

### Problem 1: Upload Spinner Stuck for Too Long
When IndexedDB is dead, each photo's `savePhotoOffline()` call waits up to **8 seconds** before the timeout fires and returns `false`. The circuit breaker only trips after 3 failures, so for a batch of photos:
- Files 1-3: each waits 8s = **24 seconds of spinner** before circuit breaker activates
- Remaining files: fail fast (circuit breaker is now open)
- Plus up to 15s for image compression per file
- The `PER_FILE_TIMEOUT` is 30 seconds, and the safety timeout scales to `30s × file_count`

A user uploading 3-5 photos could be staring at a spinner for **30-90 seconds**.

### Problem 2: User Trapped — Can't Exit
The `SaveBeforeLeaveDialog` has **all three buttons** disabled when `isSaving` is true:
```
Save & Exit         → disabled={isSaving}
Exit — Nothing to Save → disabled={isSaving}  ← BUG: should never be disabled
Stay on Page        → disabled={isSaving}  ← BUG: should never be disabled
```
If the user clicks "Save & Exit" and the save hangs on IndexedDB, `isSavingBeforeLeave` stays true for up to 8 seconds. During that window, **every button in the dialog is disabled** — the user is completely trapped with no way to cancel, leave, or stay.

## Fix Plan

### Fix 1: Never Disable Escape Buttons in `SaveBeforeLeaveDialog`
**File:** `src/components/SaveBeforeLeaveDialog.tsx`

Remove `disabled={isSaving}` from "Exit — Nothing to Save" and "Stay on Page" buttons. Only "Save & Exit" should be disabled during save. The user must always be able to leave or cancel.

### Fix 2: Pre-check Circuit Breaker in PhotoCapture
**File:** `src/components/PhotoCapture.tsx`

Before calling `savePhotoOffline()`, check `getCircuitBreakerStatus().open`. If the circuit breaker is already open (IndexedDB is known-dead), skip the 8s timeout entirely and:
- Save a lightweight receipt to localStorage (already exists)
- Show a clear toast: "Photo saved to backup storage — will sync when storage recovers"
- Return `true` so the user isn't stuck

This eliminates the 24-second circuit breaker warm-up for users whose IDB is already broken.

### Fix 3: Reduce Per-File Timeout
**File:** `src/components/PhotoCapture.tsx`

Reduce `PER_FILE_TIMEOUT` from 30s to 15s. The IDB timeout is 8s and compression timeout is 15s — a 30s per-file timeout is redundant. Also cap the safety timeout at 45s total regardless of file count.

### Fix 4: Add Cancel Button During Upload
**File:** `src/components/PhotoCapture.tsx`

Add an `AbortController`-style ref that the user can trigger to abort remaining files. When `uploading` is true, show a "Cancel" button instead of (or alongside) the spinner. Setting the cancel ref breaks out of the file processing loop in `processFiles`.

## Files Changed
1. `src/components/SaveBeforeLeaveDialog.tsx` — remove `disabled` from exit/cancel buttons
2. `src/components/PhotoCapture.tsx` — circuit breaker pre-check, reduced timeout, cancel support

## Expected Impact
- Upload spinner clears in seconds (not minutes) when IndexedDB is broken
- User can ALWAYS exit the app regardless of save/upload state
- Cancel button gives users control over stuck uploads
- Emergency localStorage receipts ensure photo metadata is never lost

