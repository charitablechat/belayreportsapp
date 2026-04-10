

# Fix: ItemPhotoUpload Missing Circuit Breaker Pre-check

## Problem

The `PhotoCapture` component was hardened with a circuit breaker pre-check, timeout protection, and a cancel button. However, the **`ItemPhotoUpload`** component (used for per-item photos in equipment/operating systems/ziplines tables) was not updated with the same protections.

When IndexedDB is broken:
- `ItemPhotoUpload.handleUpload` calls `savePhotoOffline()` without checking the circuit breaker first
- This causes an **8-second hang** per photo while IDB times out
- The spinner persists with no way to cancel
- If the user then tries to exit, the `SaveBeforeLeaveDialog` buttons work (already fixed), but the upload spinner in the table row remains stuck

## Fix

### File: `src/components/inspection/ItemPhotoUpload.tsx`

1. **Add circuit breaker pre-check** before calling `savePhotoOffline()` (same pattern as PhotoCapture). If the circuit breaker is open, immediately save a receipt to localStorage, save to device, show preview, and skip IDB entirely.

2. **Add a safety timeout** wrapping the entire `handleUpload` — cap at 15 seconds. If exceeded, force-clear `uploading` state and show an error toast.

3. **Improve the IDB failure path** (line 238-244): when `saved === false`, instead of showing an error and clearing the preview, save a receipt and keep the preview visible (same fallback pattern as PhotoCapture).

### No other files need changes

- `SaveBeforeLeaveDialog` — already fixed (exit/cancel never disabled)
- `PhotoCapture` — already hardened with circuit breaker, timeout, cancel button
- Form save-before-leave — already has 8s timeout race

## Technical Details

The key addition to `handleUpload` in `ItemPhotoUpload.tsx`:

```text
BEFORE:
  compress → savePhotoOffline (hangs 8s if IDB dead) → receipt → upload

AFTER:
  compress → check circuit breaker →
    IF OPEN: receipt + device save + preview (instant)
    IF CLOSED: savePhotoOffline →
      IF FAILED: receipt + device save + preview (graceful)
      IF OK: receipt + upload
  WRAPPED IN: 15s safety timeout
```

## Files Changed
1. `src/components/inspection/ItemPhotoUpload.tsx` — circuit breaker pre-check, safety timeout, graceful IDB failure fallback

