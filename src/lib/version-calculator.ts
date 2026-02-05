/**
 * Non-standard versioning scheme with rollover logic.
 * 
 * Format: MAJOR.MINOR.PATCH
 * 
 * Rollover Rules:
 * 1. PATCH resets to 1 when it reaches 10 (X.Y.9 → X.(Y+1).1)
 * 2. MINOR resets to 1 when it reaches 10 (X.9.x → (X+1).1.1)
 * 
 * Examples:
 * - v2.2.9 → v2.3.1
 * - v2.3.9 → v2.4.1
 * - v2.9.9 → v3.1.1
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a version string into components
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
 * Calculate the next version following rollover rules
 * @param current - Current version object or string
 */
export function getNextVersion(current: Version | string): Version {
  const version = typeof current === 'string' ? parseVersion(current) : { ...current };
  
  // Increment patch
  version.patch += 1;
  
  // Rule 1: PATCH rollover at 10
  if (version.patch >= 10) {
    version.patch = 1;
    version.minor += 1;
    
    // Rule 2: MINOR rollover at 10
    if (version.minor >= 10) {
      version.minor = 1;
      version.major += 1;
    }
  }
  
  return version;
}

/**
 * Format a version object as a string
 * @param version - Version object
 * @param prefix - Whether to include 'v' prefix (default: true)
 */
export function formatVersion(version: Version, prefix: boolean = true): string {
  const versionStr = `${version.major}.${version.minor}.${version.patch}`;
  return prefix ? `v${versionStr}` : versionStr;
}

/**
 * Get the next version string from a current version string
 * @param currentVersion - Current version string
 */
export function calculateNextVersion(currentVersion: string): string {
  const next = getNextVersion(currentVersion);
  return formatVersion(next);
}

/**
 * Generate a sequence of N versions starting from a given version
 * Useful for planning release cycles
 */
export function generateVersionSequence(startVersion: string, count: number): string[] {
  const sequence: string[] = [];
  let current = parseVersion(startVersion);
  
  for (let i = 0; i < count; i++) {
    current = getNextVersion(current);
    sequence.push(formatVersion(current));
  }
  
  return sequence;
}

/**
 * Validate that a version follows the scheme constraints
 * (MINOR and PATCH should be 1-9, not 0 or 10+)
 */
export function isValidSchemeVersion(version: Version | string): boolean {
  const v = typeof version === 'string' ? parseVersion(version) : version;
  
  return (
    v.major >= 1 &&
    v.minor >= 1 && v.minor <= 9 &&
    v.patch >= 1 && v.patch <= 9
  );
}