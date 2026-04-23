import { describe, it, expect } from 'vitest';
import { parseVersion, formatVersion } from './version-calculator';

describe('version-calculator', () => {
  describe('parseVersion', () => {
    it('parses version without prefix', () => {
      expect(parseVersion('2.3.4')).toEqual({ major: 2, minor: 3, patch: 4 });
    });

    it('parses version with v prefix', () => {
      expect(parseVersion('v2.3.4')).toEqual({ major: 2, minor: 3, patch: 4 });
    });

    it('parses version with V prefix (uppercase)', () => {
      expect(parseVersion('V2.3.4')).toEqual({ major: 2, minor: 3, patch: 4 });
    });

    it('parses build-pipeline-style versions with large patch numbers', () => {
      // The active scheme uses git commit count for PATCH — must accept double-/triple-digit values.
      expect(parseVersion('v4.7.142')).toEqual({ major: 4, minor: 7, patch: 142 });
    });

    it('throws on invalid format - missing parts', () => {
      expect(() => parseVersion('2.3')).toThrow('Invalid version format');
    });

    it('throws on invalid format - non-numeric', () => {
      expect(() => parseVersion('2.3.x')).toThrow('Invalid version format');
    });

    it('throws on invalid format - empty string', () => {
      expect(() => parseVersion('')).toThrow('Invalid version format');
    });

    it('throws on negative version components', () => {
      expect(() => parseVersion('2.-1.4')).toThrow('must be non-negative');
    });
  });

  describe('formatVersion', () => {
    it('formats with v prefix by default', () => {
      expect(formatVersion({ major: 2, minor: 3, patch: 4 })).toBe('v2.3.4');
    });

    it('formats without prefix when specified', () => {
      expect(formatVersion({ major: 2, minor: 3, patch: 4 }, false)).toBe('2.3.4');
    });

    it('formats large patch numbers correctly', () => {
      expect(formatVersion({ major: 4, minor: 7, patch: 142 })).toBe('v4.7.142');
    });
  });
});
