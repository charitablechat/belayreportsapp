/**
 * Version parsing/formatting helpers.
 *
 * NOTE: The application's canonical version scheme is `MAJOR.MINOR.<git-commit-count>`,
 * generated at build time by `vite-auto-version.ts`. There is no rollover —
 * PATCH grows monotonically with the commit count.
 *
 * This module intentionally exposes ONLY parsing/formatting utilities. Earlier
 * versions of this file shipped a 1–9 rollover calculator that conflicted with
 * the build-pipeline scheme; it was removed in Phase 4 of the security audit.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a version string into components.
 * @param versionString - Version string like "2.2.9" or "v2.2.9"
 */
export function parseVersion(versionString: string): Version {
  const cleaned = versionString.replace(/^v/i, '');
  const parts = cleaned.split('.').map(Number);

  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: "${versionString}". Expected MAJOR.MINOR.PATCH`);
  }

  const [major, minor, patch] = parts;

  if (major < 0 || minor < 0 || patch < 0) {
    throw new Error(`Version components must be non-negative: "${versionString}"`);
  }

  return { major, minor, patch };
}

/**
 * Format a version object as a string.
 * @param version - Version object
 * @param prefix - Whether to include 'v' prefix (default: true)
 */
export function formatVersion(version: Version, prefix: boolean = true): string {
  const versionStr = `${version.major}.${version.minor}.${version.patch}`;
  return prefix ? `v${versionStr}` : versionStr;
}
