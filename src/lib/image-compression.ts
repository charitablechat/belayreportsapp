/**
 * Image compression utility for mobile photo uploads
 * Reduces bandwidth usage by compressing images before upload
 */

interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxSizeMB?: number;
}

const DEFAULT_OPTIONS: CompressionOptions = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.8,
  maxSizeMB: 2,
};

// Timeout constants - reduced for faster mobile feedback
const COMPRESSION_TIMEOUT = 15000; // 15 seconds max — accommodates HEIC conversion on iPad
const IMAGE_LOAD_TIMEOUT = 4000; // 4 seconds max to load/decode image
const BLOB_CREATION_TIMEOUT = 3000; // 3 seconds max for canvas.toBlob

/** Detect mobile/tablet for reduced canvas dimensions */
const isMobileDevice = () =>
  typeof navigator !== 'undefined' &&
  /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);

import { isHeicFile, convertHeicBlobToJpeg } from '@/lib/heic-converter';

/**
 * Convert HEIC/HEIF file to JPEG using shared converter
 */
async function convertHeicToJpeg(file: File): Promise<File> {
  const jpegBlob = await convertHeicBlobToJpeg(file, 0.85);
  if (!jpegBlob) throw new Error('HEIC conversion returned null');
  
  return new File(
    [jpegBlob],
    file.name.replace(/\.(heic|heif)$/i, '.jpg'),
    { type: 'image/jpeg', lastModified: Date.now() }
  );
}

/**
 * Load image with timeout using createImageBitmap (faster) or Image element fallback
 * createImageBitmap is more robust on mobile and doesn't require FileReader
 */
async function loadImageWithTimeout(
  file: File,
  timeoutMs: number
): Promise<{ source: ImageBitmap | HTMLImageElement; cleanup: () => void }> {
  // Prefer createImageBitmap - faster and more robust on mobile
  if (typeof createImageBitmap === 'function') {
    const bitmapPromise = createImageBitmap(file);
    const result = await Promise.race([
      bitmapPromise.then(bitmap => ({ bitmap, timedOut: false })),
      new Promise<{ bitmap: null; timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ bitmap: null, timedOut: true }), timeoutMs)
      )
    ]);
    
    if (result.timedOut || !result.bitmap) {
      throw new Error('Image load timeout');
    }
    
    return {
      source: result.bitmap,
      cleanup: () => result.bitmap.close()
    };
  }

  // Fallback to Image element with object URL (faster than base64 DataURL)
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    
    const timeoutId = setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image load timeout'));
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(timeoutId);
      resolve({
        source: img,
        cleanup: () => URL.revokeObjectURL(objectUrl)
      });
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}

/**
 * Create blob with timeout protection
 * ALWAYS outputs JPEG for maximum browser compatibility (avoids HEIC/WebP issues)
 */
async function createBlobWithTimeout(
  canvas: HTMLCanvasElement,
  quality: number,
  timeoutMs: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Blob creation timeout'));
    }, timeoutMs);

    // Force JPEG output - universal browser support, avoids MIME type failures
    canvas.toBlob(
      (blob) => {
        clearTimeout(timeoutId);
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob'));
        }
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Internal compression implementation
 */
const compressImageInternal = async (
  file: File,
  options: CompressionOptions = {},
  attemptCount: number = 0
): Promise<File> => {
  // Convert HEIC/HEIF to JPEG first, then proceed with normal compression
  if (isHeicFile(file)) {
    if (import.meta.env.DEV) {
      console.log('[Image Compression] Converting HEIC/HEIF to JPEG:', file.name);
    }
    try {
      const jpegFile = await convertHeicToJpeg(file);
      // Now compress the converted JPEG through the normal pipeline
      return compressImageInternal(jpegFile, options, attemptCount);
    } catch (heicError) {
      console.warn('[Image Compression] HEIC conversion failed, returning original:', heicError);
      return file;
    }
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const MAX_ATTEMPTS = 2; // Reduced from 3 to prevent memory exhaustion on mobile

  if (attemptCount >= MAX_ATTEMPTS) {
    console.warn('[Image Compression] Max compression attempts reached, returning current file');
    return file;
  }

  let imageData: { source: ImageBitmap | HTMLImageElement; cleanup: () => void } | null = null;

  try {
    // Load image with timeout (uses createImageBitmap when available)
    imageData = await loadImageWithTimeout(file, IMAGE_LOAD_TIMEOUT);
    const { source, cleanup } = imageData;

    // Get dimensions from source
    const width = source instanceof ImageBitmap ? source.width : source.naturalWidth;
    const height = source instanceof ImageBitmap ? source.height : source.naturalHeight;

    // Calculate scaled dimensions maintaining aspect ratio
    let newWidth = width;
    let newHeight = height;

    if (width > (opts.maxWidth || Infinity) || height > (opts.maxHeight || Infinity)) {
      const ratio = Math.min(
        (opts.maxWidth || Infinity) / width,
        (opts.maxHeight || Infinity) / height
      );
      newWidth = Math.floor(width * ratio);
      newHeight = Math.floor(height * ratio);
    }

    // Create canvas and draw
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      cleanup();
      throw new Error('Failed to get canvas context');
    }

    ctx.drawImage(source, 0, 0, newWidth, newHeight);
    
    // Clean up image source immediately after drawing
    cleanup();
    imageData = null;

    // Create blob with timeout - ALWAYS outputs JPEG
    const blob = await createBlobWithTimeout(canvas, opts.quality || 0.85, BLOB_CREATION_TIMEOUT);

    // Release canvas backing store immediately — critical on iPad Safari (256MB canvas limit)
    canvas.width = 0;
    canvas.height = 0;

    // Check size and retry with lower quality if needed
    const sizeMB = blob.size / (1024 * 1024);
    if (opts.maxSizeMB && sizeMB > opts.maxSizeMB && (opts.quality || 0.85) > 0.3) {
      const lowerQuality = Math.max(0.3, (opts.quality || 0.85) - 0.2);
      
      if (import.meta.env.DEV) {
        console.log(`[Image Compression] Size ${sizeMB.toFixed(2)}MB exceeds limit, retrying with quality ${lowerQuality}`);
      }

      // Create intermediate file and recursively compress
      const intermediateFile = new File(
        [blob],
        file.name.replace(/\.[^.]+$/, '.jpg'),
        { type: 'image/jpeg', lastModified: Date.now() }
      );

      return compressImageInternal(intermediateFile, { ...opts, quality: lowerQuality }, attemptCount + 1);
    }

    // Create final compressed file with .jpg extension
    const compressedFile = new File(
      [blob],
      file.name.replace(/\.[^.]+$/, '.jpg'),
      { type: 'image/jpeg', lastModified: Date.now() }
    );

    if (import.meta.env.DEV) {
      const originalSizeMB = file.size / (1024 * 1024);
      const compressionRatio = ((1 - blob.size / file.size) * 100).toFixed(1);
      console.log('[Image Compression] Success:', {
        original: `${originalSizeMB.toFixed(2)}MB`,
        compressed: `${sizeMB.toFixed(2)}MB`,
        saved: `${compressionRatio}%`,
        dimensions: `${newWidth}x${newHeight}`,
        attempts: attemptCount + 1,
      });
    }

    return compressedFile;
  } catch (error) {
    // Clean up on error
    if (imageData) {
      imageData.cleanup();
    }
    console.warn('[Image Compression] Compression failed, returning original:', error);
    return file;
  }
};

/**
 * Compress an image file to reduce its size
 * Wrapped with timeout protection to prevent hanging on mobile devices
 * @param file - The image file to compress
 * @param options - Compression options
 * @returns Compressed image as a File object, or original if compression times out/fails
 */
export const compressImage = async (
  file: File,
  options: CompressionOptions = {}
): Promise<File> => {
  // HEIC/HEIF files MUST be converted before the small-file early-exit, or
  // small mislabelled HEIC uploads (e.g. iOS share-sheet pictures rewrapped
  // as image/heic via magic-byte detection in PhotoCapture) would be returned
  // unchanged and then rejected by the post-compression `isHeicFile` guard
  // with a misleading "HEIC conversion failed" toast.
  if (isHeicFile(file)) {
    try {
      const jpegFile = await convertHeicToJpeg(file);
      // Continue into the rest of the pipeline with the converted JPEG —
      // small-file early-exit below is fine because the file is now a JPEG.
      file = jpegFile;
    } catch (heicError) {
      console.warn('[Image Compression] HEIC conversion failed in compressImage:', heicError);
      // Fall through; downstream guards in the caller will surface the failure.
    }
  }

  // Skip compression for very small files (<100KB) - early exit
  if (file.size < 100 * 1024) {
    if (import.meta.env.DEV) {
      console.log('[Image Compression] File is small, skipping compression:', file.size);
    }
    return file;
  }

  try {
    // Race between compression and timeout
    const result = await Promise.race([
      compressImageInternal(file, options, 0),
      new Promise<File>((resolve) => {
        setTimeout(() => {
          console.warn('[Image Compression] Timed out after', COMPRESSION_TIMEOUT, 'ms - using original file');
          resolve(file);
        }, COMPRESSION_TIMEOUT);
      })
    ]);
    return result;
  } catch (error) {
    console.warn('[Image Compression] Failed, returning original:', error);
    return file;
  }
};

/**
 * Compress multiple images in parallel
 * @param files - Array of image files to compress
 * @param options - Compression options
 * @returns Array of compressed image files
 */
export const compressImages = async (
  files: File[],
  options: CompressionOptions = {}
): Promise<File[]> => {
  const startTime = Date.now();
  
  const compressedFiles = await Promise.all(
    files.map(file => compressImage(file, options))
  );

  if (import.meta.env.DEV) {
    const totalTime = Date.now() - startTime;
    console.log(`[Image Compression] Batch completed: ${files.length} files in ${totalTime}ms`);
  }

  return compressedFiles;
};
