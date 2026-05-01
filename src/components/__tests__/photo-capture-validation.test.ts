import { describe, it, expect } from 'vitest';
import { validateFile, MAX_FILE_SIZE_MB } from '../photo-capture-validation';

/**
 * Audit M2: validateFile contract — particularly around the iOS share-sheet
 * case where `file.type` arrives empty.
 */

function makeFile(name: string, type: string, sizeBytes = 1024): File {
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], name, { type });
}

describe('validateFile (audit M2)', () => {
  it('accepts a normal JPEG with type', () => {
    expect(validateFile(makeFile('photo.jpg', 'image/jpeg'))).toEqual({ valid: true });
  });

  it('accepts an iOS share-sheet upload with empty type but JPEG name', () => {
    expect(validateFile(makeFile('IMG_0001.jpg', ''))).toEqual({ valid: true });
  });

  it('accepts an iOS share-sheet HEIC with empty type', () => {
    expect(validateFile(makeFile('IMG_0001.HEIC', ''))).toEqual({ valid: true });
  });

  it('accepts a name with .png extension and empty type', () => {
    expect(validateFile(makeFile('shot.PNG', ''))).toEqual({ valid: true });
  });

  it('rejects empty files', () => {
    const result = validateFile(makeFile('photo.jpg', 'image/jpeg', 0));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('rejects empty type AND non-image extension with the new clearer error', () => {
    const result = validateFile(makeFile('untitled', ''));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Could not determine file type/);
    // The previous "Unsupported file type: unknown" wording must NOT appear.
    expect(result.error).not.toMatch(/unknown/);
  });

  it('rejects a non-image MIME type', () => {
    const result = validateFile(makeFile('doc.pdf', 'application/pdf'));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unsupported file type: application\/pdf/);
  });

  it('rejects files over the size limit', () => {
    const tooBig = (MAX_FILE_SIZE_MB + 1) * 1024 * 1024;
    const result = validateFile(makeFile('big.jpg', 'image/jpeg', tooBig));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it('accepts a generic image/* type even if not in the explicit allowlist', () => {
    expect(validateFile(makeFile('photo.bmp', 'image/bmp'))).toEqual({ valid: true });
  });
});
