/**
 * Shared HEIC-to-JPEG conversion utility for blobs
 * Used by PhotoGallery (display) and image-compression (upload)
 */

const HEIC_EXTENSIONS = /\.(heic|heif)$/i;
const HEIC_TYPES = ['image/heic', 'image/heif'];

/** HEIC/HEIF ftyp brand identifiers (bytes 4–12 of the file) */
const HEIC_BRANDS = ['ftyp heic', 'ftypheic', 'ftyp heis', 'ftypheis', 'ftyp mif1', 'ftypmif1'];

/** Check if a storage path or URL points to a HEIC file */
export function isHeicPath(path: string): boolean {
  return HEIC_EXTENSIONS.test(path);
}

/**
 * Detect HEIC/HEIF by inspecting the first 12 bytes (magic bytes).
 * Works even when the file has a .jpg extension (mislabeled files).
 */
export async function isHeicBlob(blob: Blob): Promise<boolean> {
  try {
    const slice = blob.slice(0, 12);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 12) return false;

    // ftyp box: bytes 4-7 should be "ftyp", bytes 8-11 the brand
    const decoder = new TextDecoder('ascii');
    const ftypTag = decoder.decode(bytes.slice(4, 8));
    if (ftypTag !== 'ftyp') return false;

    const brand = decoder.decode(bytes.slice(8, 12)).toLowerCase();
    return brand === 'heic' || brand === 'heis' || brand === 'mif1';
  } catch {
    return false;
  }
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
/** Detect iOS for tuning conversion timeouts (older iPads are slow at JS HEIC decoding). */
function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
}

async function decodeOnce(blob: Blob, quality: number, timeoutMs: number): Promise<Blob | null> {
  const heic2any = (await import('heic2any')).default;
  const result = await Promise.race([
    heic2any({ blob, toType: 'image/jpeg', quality }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`HEIC conversion timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
  return Array.isArray(result) ? result[0] : (result as Blob);
}

export async function convertHeicBlobToJpeg(
  blob: Blob,
  quality = 0.85
): Promise<Blob | null> {
  // iOS devices (especially older iPads) need more time for pure-JS HEIC decoding.
  const timeoutMs = isIOSDevice() ? 25000 : 10000;
  const allowRetry = isIOSDevice();
  try {
    return await decodeOnce(blob, quality, timeoutMs);
  } catch (e) {
    if (allowRetry) {
      console.warn('[heic-converter] First attempt failed, retrying once on iOS:', e);
      try {
        return await decodeOnce(blob, quality, timeoutMs);
      } catch (e2) {
        console.warn('[heic-converter] Retry also failed:', e2);
        return null;
      }
    }
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
