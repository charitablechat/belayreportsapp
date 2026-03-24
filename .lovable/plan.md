

## Native Camera Capture for ItemPhotoUpload

### Problem
The camera button currently uses `<input type="file" capture="environment">`, which on some devices still opens a file picker or gives an ambiguous choice. The user wants clicking the camera icon to directly open a live camera viewfinder using the browser's native MediaDevices API (`getUserMedia`), bypassing the file system entirely.

### Solution

Create a reusable `CameraCapture` dialog component that opens a live camera stream via `navigator.mediaDevices.getUserMedia()`, lets the user take a photo by tapping a shutter button, and returns the captured image as a `File` object. Integrate it into `ItemPhotoUpload` to replace the `<input type="file" capture>` approach for the camera button.

### Files Changed

| File | Change |
|------|--------|
| `src/components/ui/camera-capture-dialog.tsx` | **New file.** Reusable dialog with live `<video>` viewfinder, shutter button, preview/retake flow. Uses `getUserMedia({ video: { facingMode: 'environment' } })` for rear camera. Captures frame to `<canvas>`, converts to JPEG blob, returns as `File`. Handles permissions, errors, and cleanup. |
| `src/components/inspection/ItemPhotoUpload.tsx` | Replace `cameraInputRef` click with opening the new `CameraCapture` dialog. Keep the `<input type="file">` for the "Upload from device" (ImagePlus) button unchanged. Pass captured `File` to existing `handleUpload`. |

### Technical Detail

**camera-capture-dialog.tsx** — Core flow:
1. On open: request `getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })`
2. Stream feeds a `<video autoPlay playsInline>` element (full-dialog viewfinder)
3. Shutter button captures current frame to an offscreen `<canvas>`, calls `canvas.toBlob('image/jpeg', 0.9)`
4. Shows preview with Retake / Use Photo buttons
5. On "Use Photo": converts blob to `File`, calls `onCapture(file)`, stops stream, closes dialog
6. On close/unmount: always stops all media tracks to release camera

**ItemPhotoUpload.tsx** changes:
- Add `const [cameraOpen, setCameraOpen] = useState(false)`
- Camera button onClick becomes `setCameraOpen(true)` instead of `cameraInputRef.current?.click()`
- Remove the `<input capture="environment">` element entirely
- Render `<CameraCaptureDialog open={cameraOpen} onOpenChange={setCameraOpen} onCapture={(file) => handleUpload(file)} />`
- Same pattern in the lightbox "Take Photo" button

This approach works across all report types since `ItemPhotoUpload` is the shared component used in Operating Systems, Ziplines, and Equipment tables. The `CameraCaptureDialog` is generic and reusable for any future camera needs.

