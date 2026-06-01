/**
 * Rollover tests for the simple single-digit version bumper.
 *
 * Product rule (per Brenda, 2026-06):
 *   patch increments 0..9; at 9 it rolls to 0 and carries +1 to minor.
 *   minor increments 0..9; at 9 it rolls to 0 and carries +1 to major.
 *   major has no cap.
 *
 * Also asserts that the existing `isVersionNewer` comparator correctly orders
 * versions across the rollover boundary, so the stale-build banner and the
 * min-version policy keep working after the switch from the old monotonic
 * commit-count patch scheme.
 */
import { describe, it, expect } from 'vitest';
import { bumpVersion } from '../../../scripts/bump-version.mjs';
import { isVersionNewer } from '../version-check';

describe('bumpVersion — single-digit rollover', () => {
  it('increments patch normally', () => {
    expect(bumpVersion('4.8.0', 'patch')).toBe('4.8.1');
    expect(bumpVersion('4.8.5', 'patch')).toBe('4.8.6');
  });

  it('rolls patch 9 → next minor', () => {
    expect(bumpVersion('4.8.9', 'patch')).toBe('4.9.0');
  });

  it('rolls patch at minor 9.9 → next major', () => {
    expect(bumpVersion('4.9.9', 'patch')).toBe('5.0.0');
  });

  it('bumps minor and resets patch', () => {
    expect(bumpVersion('4.8.5', 'minor')).toBe('4.9.0');
    expect(bumpVersion('4.9.5', 'minor')).toBe('5.0.0');
  });

  it('bumps major and resets minor + patch', () => {
    expect(bumpVersion('4.8.5', 'major')).toBe('5.0.0');
  });

  it('rejects malformed input', () => {
    expect(() => bumpVersion('not.a.version', 'patch')).toThrow();
    expect(() => bumpVersion('4.8', 'patch')).toThrow();
    expect(() => bumpVersion('4.8.5', 'bogus' as any)).toThrow();
  });
});

describe('isVersionNewer — ordering across rollover boundary', () => {
  it('orders short SemVer correctly', () => {
    expect(isVersionNewer('4.8.0', '4.8.1')).toBe(true);
    expect(isVersionNewer('4.8.9', '4.9.0')).toBe(true);
    expect(isVersionNewer('4.9.9', '5.0.0')).toBe(true);
    expect(isVersionNewer('5.0.0', '4.9.9')).toBe(false);
    expect(isVersionNewer('4.8.5', '4.8.5')).toBe(false);
  });

  it('treats the old long commit-count version as older than the new scheme', () => {
    // The previous scheme produced patches like 4.7.743127. Under numeric
    // SemVer, 4.8.0 must compare strictly newer so users on the old build
    // are correctly prompted to update after this release ships.
    expect(isVersionNewer('4.7.743127', '4.8.0')).toBe(true);
  });
});
