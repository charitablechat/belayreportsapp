import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  getNextVersion,
  formatVersion,
  calculateNextVersion,
  generateVersionSequence,
  isValidSchemeVersion,
  Version
} from './version-calculator';

describe('version-calculator', () => {
  describe('parseVersion', () => {
    it('parses version without prefix', () => {
      const result = parseVersion('2.3.4');
      expect(result).toEqual({ major: 2, minor: 3, patch: 4 });
    });

    it('parses version with v prefix', () => {
      const result = parseVersion('v2.3.4');
      expect(result).toEqual({ major: 2, minor: 3, patch: 4 });
    });

    it('parses version with V prefix (uppercase)', () => {
      const result = parseVersion('V2.3.4');
      expect(result).toEqual({ major: 2, minor: 3, patch: 4 });
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

  describe('getNextVersion', () => {
    it('increments patch normally (v2.3.4 → v2.3.5)', () => {
      const result = getNextVersion({ major: 2, minor: 3, patch: 4 });
      expect(result).toEqual({ major: 2, minor: 3, patch: 5 });
    });

    it('increments patch from string input', () => {
      const result = getNextVersion('v2.3.4');
      expect(result).toEqual({ major: 2, minor: 3, patch: 5 });
    });

    it('rolls over patch at 10 (v2.3.9 → v2.4.1)', () => {
      const result = getNextVersion({ major: 2, minor: 3, patch: 9 });
      expect(result).toEqual({ major: 2, minor: 4, patch: 1 });
    });

    it('rolls over minor at 10 (v2.9.9 → v3.1.1)', () => {
      const result = getNextVersion({ major: 2, minor: 9, patch: 9 });
      expect(result).toEqual({ major: 3, minor: 1, patch: 1 });
    });

    it('handles double rollover (v9.9.9 → v10.1.1)', () => {
      const result = getNextVersion({ major: 9, minor: 9, patch: 9 });
      expect(result).toEqual({ major: 10, minor: 1, patch: 1 });
    });

    it('handles minimum valid version (v1.1.1 → v1.1.2)', () => {
      const result = getNextVersion({ major: 1, minor: 1, patch: 1 });
      expect(result).toEqual({ major: 1, minor: 1, patch: 2 });
    });

    it('does not mutate input object', () => {
      const input: Version = { major: 2, minor: 3, patch: 4 };
      getNextVersion(input);
      expect(input).toEqual({ major: 2, minor: 3, patch: 4 });
    });
  });

  describe('formatVersion', () => {
    it('formats with v prefix by default', () => {
      const result = formatVersion({ major: 2, minor: 3, patch: 4 });
      expect(result).toBe('v2.3.4');
    });

    it('formats without prefix when specified', () => {
      const result = formatVersion({ major: 2, minor: 3, patch: 4 }, false);
      expect(result).toBe('2.3.4');
    });

    it('formats double-digit versions correctly', () => {
      const result = formatVersion({ major: 10, minor: 1, patch: 1 });
      expect(result).toBe('v10.1.1');
    });
  });

  describe('calculateNextVersion', () => {
    it('returns next version string with prefix', () => {
      expect(calculateNextVersion('v2.3.4')).toBe('v2.3.5');
    });

    it('handles input without prefix', () => {
      expect(calculateNextVersion('2.3.4')).toBe('v2.3.5');
    });

    it('handles PATCH rollover', () => {
      expect(calculateNextVersion('v2.3.9')).toBe('v2.4.1');
    });

    it('handles MINOR rollover', () => {
      expect(calculateNextVersion('v2.9.9')).toBe('v3.1.1');
    });
  });

  describe('generateVersionSequence', () => {
    it('generates correct sequence of versions', () => {
      const sequence = generateVersionSequence('v2.3.7', 4);
      expect(sequence).toEqual(['v2.3.8', 'v2.3.9', 'v2.4.1', 'v2.4.2']);
    });

    it('generates empty array for count 0', () => {
      const sequence = generateVersionSequence('v2.3.4', 0);
      expect(sequence).toEqual([]);
    });

    it('handles rollover across sequence', () => {
      const sequence = generateVersionSequence('v2.9.8', 3);
      expect(sequence).toEqual(['v2.9.9', 'v3.1.1', 'v3.1.2']);
    });
  });

  describe('isValidSchemeVersion', () => {
    it('returns true for valid scheme version', () => {
      expect(isValidSchemeVersion({ major: 2, minor: 3, patch: 4 })).toBe(true);
    });

    it('returns true for string input', () => {
      expect(isValidSchemeVersion('v2.3.4')).toBe(true);
    });

    it('returns false for major < 1', () => {
      expect(isValidSchemeVersion({ major: 0, minor: 3, patch: 4 })).toBe(false);
    });

    it('returns false for minor < 1', () => {
      expect(isValidSchemeVersion({ major: 2, minor: 0, patch: 4 })).toBe(false);
    });

    it('returns false for minor > 9', () => {
      expect(isValidSchemeVersion({ major: 2, minor: 10, patch: 4 })).toBe(false);
    });

    it('returns false for patch < 1', () => {
      expect(isValidSchemeVersion({ major: 2, minor: 3, patch: 0 })).toBe(false);
    });

    it('returns false for patch > 9', () => {
      expect(isValidSchemeVersion({ major: 2, minor: 3, patch: 10 })).toBe(false);
    });

    it('returns true for boundary values (v1.1.1)', () => {
      expect(isValidSchemeVersion({ major: 1, minor: 1, patch: 1 })).toBe(true);
    });

    it('returns true for boundary values (v99.9.9)', () => {
      expect(isValidSchemeVersion({ major: 99, minor: 9, patch: 9 })).toBe(true);
    });
  });
});
