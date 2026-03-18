/**
 * Shared HEIC-to-JPEG conversion utility for blobs
 * Used by PhotoGallery (display) and image-compression (upload)
 */

const HEIC_EXTENSIONS = /\.(heic|heif)$/i;
const HEIC_TYPES = ['image/heic', 'image/heif'];

/** Check if a storage path or URL points to a HEIC file */
export function isHeicPath(path: string): boolean {
  return HEIC_EXTENSIONS.test(path);
}

/** Check if a File/Blob is HEIC by type or name */
export function isHeicFile(file: File): boolean {
  if (HEIC_TYPES.includes(file.type.toLowerCase())) return true;
  const ext = file.name.toLowerCase().split('.').pop();
  return ext === 'heic' || ext === 'heif';
}

/**
 * Convert a HEIC/HEIF blob to JPEG.
 * Returns the converted JPEG blob, or null on failure.
 */
export async function convertHeicBlobToJpeg(
  blob: Blob,
  quality = 0.85
): Promise<Blob | null> {
  try {
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({
      blob,
      toType: 'image/jpeg',
      quality,
    });
    return Array.isArray(result) ? result[0] : result;
  } catch (e) {
    console.warn('[heic-converter] Conversion failed:', e);
    return null;
  }
}

/**
 * Convert up to `concurrency` HEIC blobs in parallel.
 * Returns a Map<index, convertedBlob> for successful conversions.
 */
export async function batchConvertHeicBlobs(
  items: { index: number; blob: Blob }[],
  concurrency = 3,
  quality = 0.85
): Promise<Map<number, Blob>> {
  const results = new Map<number, Blob>();
  
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async ({ index, blob }) => {
        const converted = await convertHeicBlobToJpeg(blob, quality);
        if (converted) results.set(index, converted);
      })
    );
    // Log failures in dev
    if (import.meta.env.DEV) {
      settled.forEach((r, idx) => {
        if (r.status === 'rejected') {
          console.warn(`[heic-converter] Batch item ${chunk[idx].index} failed:`, r.reason);
        }
      });
    }
  }
  
  return results;
}
