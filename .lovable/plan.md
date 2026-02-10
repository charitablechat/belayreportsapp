
# Auto-Save Photos to Device on Capture

## Overview

After each photo is captured and compressed in the app, automatically trigger a browser download so the image is saved to the device's Downloads folder (or Photos on some mobile browsers). This runs silently alongside the existing IndexedDB save -- no user interaction required.

## How It Works

Browsers support programmatic downloads via a hidden `<a>` element with the `download` attribute. When clicked, the file is saved to the device's default download location (typically "Downloads" on Android, "Downloads" or Files app on iOS Safari). This is a well-supported, no-permission-required mechanism.

## Limitations (Important)

- **iOS Safari**: Downloads go to the Files app, not the Photos app. Users will find images in Files > Downloads. There is no way for a PWA to save directly to the iOS Camera Roll.
- **Android Chrome**: Downloads go to the Downloads folder and typically also appear in the Gallery app automatically.
- **No silent save**: Some browsers may briefly show a download notification/bar -- this is expected and cannot be suppressed.

## Technical Changes

### 1. New utility: `src/lib/save-to-device.ts`

Create a small helper function that:
- Takes a `Blob` and a `fileName`
- Creates a temporary object URL
- Creates a hidden `<a>` element with `download` attribute set to the filename
- Programmatically clicks it to trigger the download
- Cleans up the object URL and element afterwards

```
function saveToDevice(blob: Blob, fileName: string): void
```

The filename will follow the pattern: `RopeWorks_[section]_[timestamp].jpg` for easy identification in the device's file manager.

### 2. Modify `src/components/PhotoCapture.tsx`

In the `processSingleFile` function, immediately after the image is compressed (around line 135) and before saving to IndexedDB, call `saveToDevice(processedFile, formattedFileName)`.

This is a fire-and-forget call -- it does not block the rest of the pipeline (IndexedDB save, gallery refresh, background upload). If it fails for any reason, it logs a warning and continues normally.

## File Summary

| File | Change |
|------|--------|
| `src/lib/save-to-device.ts` | New file -- download helper utility |
| `src/components/PhotoCapture.tsx` | Add auto-save call after compression |
