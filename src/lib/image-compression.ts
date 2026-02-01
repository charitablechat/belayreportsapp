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
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.8,
  maxSizeMB: 2,
};

// Maximum time to wait for compression before falling back to original
const COMPRESSION_TIMEOUT = 10000; // 10 seconds

/**
 * Internal compression implementation
 */
const compressImageInternal = async (
  file: File,
  options: CompressionOptions = {},
  attemptCount: number = 0
): Promise<File> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Max 3 attempts to prevent infinite recursion
  const MAX_ATTEMPTS = 3;
  
  if (attemptCount >= MAX_ATTEMPTS) {
    console.warn('[Image Compression] Max compression attempts reached, returning current file');
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };

    reader.onerror = reject;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Calculate new dimensions while maintaining aspect ratio
        if (width > (opts.maxWidth || Infinity) || height > (opts.maxHeight || Infinity)) {
          const ratio = Math.min(
            (opts.maxWidth || Infinity) / width,
            (opts.maxHeight || Infinity) / height
          );
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          async (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }

            // Check if compressed size is within limits
            const sizeMB = blob.size / (1024 * 1024);
            if (opts.maxSizeMB && sizeMB > opts.maxSizeMB && (opts.quality || 0.8) > 0.1) {
              // If still too large, try with lower quality
              const lowerQuality = Math.max(0.1, (opts.quality || 0.8) - 0.1);
              if (import.meta.env.DEV) {
                console.log(`[Image Compression] Size ${sizeMB.toFixed(2)}MB exceeds limit, retrying with quality ${lowerQuality} (attempt ${attemptCount + 1}/${MAX_ATTEMPTS})`);
              }
              
              // Create File from compressed blob and recursively compress
              const intermediateFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              
              try {
                const furtherCompressed = await compressImageInternal(
                  intermediateFile,
                  { ...opts, quality: lowerQuality },
                  attemptCount + 1
                );
                resolve(furtherCompressed);
              } catch (error) {
                reject(error);
              }
              return;
            }

            // Create new file with compressed data
            const compressedFile = new File([blob], file.name, {
              type: file.type || 'image/jpeg',
              lastModified: Date.now(),
            });

            const originalSizeMB = file.size / (1024 * 1024);
            const compressionRatio = ((1 - blob.size / file.size) * 100).toFixed(1);

            if (import.meta.env.DEV) {
              console.log('[Image Compression] Success:', {
                original: `${originalSizeMB.toFixed(2)}MB`,
                compressed: `${sizeMB.toFixed(2)}MB`,
                saved: `${compressionRatio}%`,
                dimensions: `${width}x${height}`,
                attempts: attemptCount + 1,
              });
            }

            resolve(compressedFile);
          },
          file.type || 'image/jpeg',
          opts.quality
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image'));

    reader.readAsDataURL(file);
  });
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
