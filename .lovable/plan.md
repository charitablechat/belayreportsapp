

## Universal Prompt: Camera Capture + Dashboard Stale Data Fix

This is a reference prompt, not a code change. Copy and use in other projects.

---

### Universal Prompt

```
Implement the following two features:

## 1. Native Camera Capture Dialog

Create a reusable camera capture dialog component that uses `navigator.mediaDevices.getUserMedia()` to open a live camera viewfinder instead of relying on `<input type="file" capture>`.

**Component: `CameraCaptureDialog`**
- Props: `open`, `onOpenChange`, `onCapture(file: File)`
- On open: request `getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })`
- Render a full-dialog `<video autoPlay playsInline>` viewfinder
- Shutter button captures current frame to an offscreen `<canvas>`, calls `canvas.toBlob('image/jpeg', 0.9)`
- Show preview with Retake / Use Photo buttons
- On "Use Photo": convert blob to `File`, call `onCapture(file)`, stop stream, close
- On close/unmount: always stop all media tracks to release camera hardware
- Handle permission denied and getUserMedia errors gracefully with user-facing messages
- Provide a fallback for devices that don't support getUserMedia (fall back to `<input type="file" capture="environment">`)

**Integration:**
- In any photo upload component with a camera button, replace `<input type="file" capture>` click with opening `CameraCaptureDialog`
- Keep the separate "Upload from device" button using standard `<input type="file" accept="image/*">` unchanged
- Pass the captured `File` into the existing upload handler

## 2. Dashboard Stale Data / "0" Count Fix

When navigating away from and returning to a dashboard that displays report counts and lists, the page can show '0' or empty state instead of actual data. Fix this with two changes:

**A. Safety timeout must not validate data:**
- If there is a safety timeout that sets `loading=false` to unblock the UI after a period, it must NOT also mark data as "validated" or "loaded". Only actual successful data fetches (or confirmed empty results from the server) should mark data as validated.
- Increase safety timeout to 20s to accommodate slow networks.

**B. Tab/section counts must guard against premature "0":**
- When rendering counts (e.g., "Inspections (5)"), use this pattern:
  ```
  loading || (!serverTotal && localArray.length === 0)
    ? '…'
    : (serverTotal ?? localArray.length)
  ```
- This ensures the count shows a loading indicator instead of '0' when data hasn't arrived yet but the loading spinner has already been dismissed by a safety timeout.

**Key principle:** Never display a hard "0" count unless the server has explicitly confirmed empty data. During any ambiguous state (timeout, in-flight request, stale cache), show a loading placeholder.
```

