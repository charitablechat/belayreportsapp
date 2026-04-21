import { isIOS, isPWA } from "@/lib/mobile-detection";

/**
 * iOS Safari (especially in standalone PWA mode) silently no-ops `<a download>`
 * for blob URLs. When available, fall back to the native Web Share sheet so
 * the user can save to Files / Photos / etc.
 */
async function tryNativeShare(blob: Blob, fileName: string): Promise<boolean> {
  try {
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
      return false;
    }
    const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });
    const shareData = { files: [file], title: fileName } as ShareData;
    if (!nav.canShare(shareData)) return false;
    await nav.share(shareData);
    return true;
  } catch (err) {
    // User cancellation throws AbortError — treat as handled
    if ((err as DOMException)?.name === "AbortError") return true;
    console.warn("[saveToDevice] Web Share fallback failed:", err);
    return false;
  }
}

/**
 * Desktop Edge/Chrome: prefer the File System Access API so the user picks a
 * destination via the native Save dialog instead of dumping into Downloads.
 * Returns true when the file was written (or the user cancelled — treated as
 * handled). Returns false when the API is unavailable or fails unexpectedly,
 * so callers can fall back to anchor-download.
 */
async function trySaveFilePicker(blob: Blob, fileName: string): Promise<boolean> {
  try {
    const win = window as Window & {
      showSaveFilePicker?: (opts?: {
        suggestedName?: string;
        types?: Array<{ description?: string; accept: Record<string, string[]> }>;
      }) => Promise<{
        createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
      }>;
    };
    if (typeof win.showSaveFilePicker !== "function") return false;
    const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
    const mime = blob.type || "application/octet-stream";
    const handle = await win.showSaveFilePicker({
      suggestedName: fileName,
      types: ext
        ? [{ description: "File", accept: { [mime]: [ext] } }]
        : undefined,
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") return true; // user cancelled
    console.warn("[saveToDevice] showSaveFilePicker failed:", err);
    return false;
  }
}

function programmaticDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Save a blob to the device.
 * - On iOS standalone PWA: prefer Web Share API (only reliable path).
 * - Elsewhere: programmatic download via <a download>.
 * Fire-and-forget — logs warnings on failure but never throws.
 */
export function saveToDevice(blob: Blob, fileName: string): void {
  try {
    // iOS standalone PWA cannot reliably trigger downloads — use Web Share.
    if (isIOS() && isPWA()) {
      tryNativeShare(blob, fileName).then((shared) => {
        if (!shared) programmaticDownload(blob, fileName);
      });
      return;
    }
    programmaticDownload(blob, fileName);
  } catch (error) {
    console.warn("[saveToDevice] Failed to save to device:", error);
  }
}

/**
 * Async variant for explicit user-triggered saves (e.g. backup downloads)
 * where we want to await the share sheet. Returns true if the file was
 * delivered to the user (download started or share completed).
 */
export async function saveToDeviceAsync(blob: Blob, fileName: string): Promise<boolean> {
  try {
    if (isIOS()) {
      const shared = await tryNativeShare(blob, fileName);
      if (shared) return true;
    }
    // W4: desktop Edge/Chrome — prefer native Save As dialog when available.
    const picked = await trySaveFilePicker(blob, fileName);
    if (picked) return true;
    programmaticDownload(blob, fileName);
    return true;
  } catch (error) {
    console.warn("[saveToDevice] Async save failed:", error);
    return false;
  }
}
