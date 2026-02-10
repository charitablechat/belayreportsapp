/**
 * Save a photo to the device's Downloads folder via programmatic download.
 * Fire-and-forget — logs warnings on failure but never throws.
 */
export function saveToDevice(blob: Blob, fileName: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    // Clean up after a short delay to ensure download starts
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (error) {
    console.warn('[saveToDevice] Failed to save photo to device:', error);
  }
}
