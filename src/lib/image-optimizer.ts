export interface OptimizeOptions {
  maxWidth: number;
  maxHeight: number;
  quality?: number;
  format?: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface OptimizedResult {
  blob: Blob;
  originalSize: number;
  optimizedSize: number;
  originalDimensions: ImageDimensions;
  optimizedDimensions: ImageDimensions;
  compressionRatio: string;
  formatChanged: boolean;
  originalFormat: string;
  optimizedFormat: string;
}

// Optimal dimensions for different logo types
export const LOGO_PRESETS = {
  belayReports: {
    maxWidth: 300,
    maxHeight: 140,
    label: 'Belay Reports Logo (300×140px)'
  },
  acct: {
    maxWidth: 240,
    maxHeight: 120,
    label: 'ACCT Badge (240×120px)'
  }
};

/**
 * Load an image file and return an HTMLImageElement
 */
const loadImage = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Get dimensions of an image file
 */
export const getImageDimensions = async (file: File): Promise<ImageDimensions> => {
  const img = await loadImage(file);
  return {
    width: img.naturalWidth,
    height: img.naturalHeight
  };
};

/**
 * Calculate target dimensions while maintaining aspect ratio
 */
const calculateDimensions = (
  img: HTMLImageElement,
  maxWidth: number,
  maxHeight: number
): ImageDimensions => {
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  // Calculate aspect ratio
  const aspectRatio = width / height;

  // Scale down if needed
  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspectRatio;
  }

  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  // Round to whole pixels
  return {
    width: Math.round(width),
    height: Math.round(height)
  };
};

/**
 * Optimize and resize an image file
 */
export const optimizeImage = async (
  file: File,
  options: OptimizeOptions
): Promise<OptimizedResult> => {
  const {
    maxWidth,
    maxHeight,
    quality = 0.92,
    format = 'image/png'
  } = options;

  // Load the image
  const img = await loadImage(file);
  
  // Get original dimensions
  const originalDimensions: ImageDimensions = {
    width: img.naturalWidth,
    height: img.naturalHeight
  };

  // Calculate target dimensions
  const targetDimensions = calculateDimensions(img, maxWidth, maxHeight);

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetDimensions.width;
  canvas.height = targetDimensions.height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Enable image smoothing for better quality
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw resized image
  ctx.drawImage(img, 0, 0, targetDimensions.width, targetDimensions.height);

  // Convert to blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Failed to create blob'));
        }
      },
      format,
      quality
    );
  });

  // Clean up
  URL.revokeObjectURL(img.src);

  // Calculate compression ratio
  const compressionRatio = ((file.size - blob.size) / file.size * 100).toFixed(1);

  return {
    blob,
    originalSize: file.size,
    optimizedSize: blob.size,
    originalDimensions,
    optimizedDimensions: targetDimensions,
    compressionRatio,
    formatChanged: file.type !== format,
    originalFormat: file.type,
    optimizedFormat: format
  };
};

/**
 * Format file size for display
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Format dimensions for display
 */
export const formatDimensions = (dimensions: ImageDimensions): string => {
  return `${dimensions.width}×${dimensions.height}px`;
};
