import { describe, expect, it } from 'vitest';
import {
  LARGE_SOURCE_PIXEL_THRESHOLD,
  shouldPreScaleSource,
} from '../image-compression';

describe('shouldPreScaleSource (Audit C2.7)', () => {
  it('returns true when source is above the 16MP threshold', () => {
    // 50MP Android camera shot — typical worst case
    expect(shouldPreScaleSource(8160, 6120)).toBe(true);
    // Just above the threshold
    expect(shouldPreScaleSource(4001, 4001)).toBe(true);
  });

  it('returns false when source is at or below the threshold', () => {
    // Threshold itself — strictly greater-than, so this is below
    expect(shouldPreScaleSource(4000, 4000)).toBe(false);
    // 12MP — typical iPhone main camera
    expect(shouldPreScaleSource(4032, 3024)).toBe(false);
    // 8MP — older iPad
    expect(shouldPreScaleSource(3264, 2448)).toBe(false);
  });

  it('returns false for invalid dimensions', () => {
    expect(shouldPreScaleSource(0, 4000)).toBe(false);
    expect(shouldPreScaleSource(-1, 4000)).toBe(false);
    expect(shouldPreScaleSource(NaN, 4000)).toBe(false);
    expect(shouldPreScaleSource(4000, Infinity)).toBe(false);
  });

  it('threshold constant is exactly 16MP for transparency', () => {
    expect(LARGE_SOURCE_PIXEL_THRESHOLD).toBe(16_000_000);
  });
});
