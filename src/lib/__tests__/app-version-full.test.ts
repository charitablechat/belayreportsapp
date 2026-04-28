/**
 * APP_VERSION_FULL contract tests (audit PR-C).
 *
 * Locks the canonical version-stamp format used by:
 *  - attestation records (`app_version_at_completion`)
 *  - Sentry release tag
 *  - any future audit/observability stamp
 *
 * The format is `${APP_VERSION}+${BUILD_COMMIT}` when a real commit hash is
 * available, else just `APP_VERSION`. The `+suffix` shape is SemVer's
 * build-metadata convention so existing comparator logic that strips
 * `+suffix` (`version-check.ts:84`, `version-telemetry.ts:43`) keeps working.
 *
 * Tests drive `buildVersionFull` directly because `import.meta.env.*` values
 * are statically replaced by Vite's `define` plugin and therefore not
 * stubbable at runtime.
 *
 * Why these tests exist: prior to PR-C every attestation stamp and Sentry
 * release was the bare SemVer. When two distinct deploys shared the same
 * SemVer (e.g. a hotfix re-built from the same tag, or a Lovable rebuild)
 * their audit records and error groupings were indistinguishable. The
 * regression-lock test in this file proves the new format is uniqueness-
 * preserving across same-SemVer rebuilds.
 */

import { describe, it, expect } from 'vitest';
import { buildVersionFull, APP_VERSION_FULL, APP_VERSION } from '../attestation';

describe('buildVersionFull', () => {
  it('is `${version}+${commit}` when both are available', () => {
    expect(buildVersionFull('4.7.2', 'abc1234')).toBe('4.7.2+abc1234');
  });

  it('falls back to bare version when commit is empty string', () => {
    expect(buildVersionFull('4.7.2', '')).toBe('4.7.2');
  });

  it('falls back to bare version when commit is undefined', () => {
    expect(buildVersionFull('4.7.2', undefined)).toBe('4.7.2');
  });

  it('falls back to bare version when commit is null', () => {
    expect(buildVersionFull('4.7.2', null)).toBe('4.7.2');
  });

  it('falls back to bare version when commit is the literal "dev" placeholder', () => {
    // vite-auto-version emits 'dev' in unbuilt environments; we don't want
    // 'dev' to leak into prod attestation stamps if injection misfires.
    expect(buildVersionFull('4.7.2', 'dev')).toBe('4.7.2');
  });

  it('trims whitespace from commit before composing', () => {
    expect(buildVersionFull('4.7.2', '  abc1234  ')).toBe('4.7.2+abc1234');
  });

  it('falls back to bare version when commit is whitespace-only', () => {
    expect(buildVersionFull('4.7.2', '   ')).toBe('4.7.2');
  });

  it('preserves "unknown" version when no commit is available', () => {
    expect(buildVersionFull('unknown', '')).toBe('unknown');
  });

  it('matches SemVer build-metadata convention so version-check comparator can strip it', () => {
    // version-check.ts and version-telemetry.ts split on '+' and take index 0.
    const stamp = buildVersionFull('4.7.2', 'abc1234');
    expect(stamp.split('+')[0]).toBe('4.7.2');
  });

  it('regression-lock: two same-SemVer deploys produce distinct stamps', () => {
    // Audit HIGH-3 root cause: a Lovable rebuild or a hotfix re-built from
    // the same tag would stamp identical SemVers, making attestation records
    // and Sentry release groups collide. After PR-C the build commit hash
    // disambiguates them.
    const stampA = buildVersionFull('4.7.2', 'abc1234');
    const stampB = buildVersionFull('4.7.2', 'def5678');
    expect(stampA).not.toBe(stampB);
    expect(stampA.split('+')[0]).toBe(stampB.split('+')[0]);
  });
});

describe('APP_VERSION_FULL constant', () => {
  it('is a string (resolved via buildVersionFull at module load)', () => {
    expect(typeof APP_VERSION_FULL).toBe('string');
    expect(APP_VERSION_FULL.length).toBeGreaterThan(0);
  });

  it('starts with APP_VERSION', () => {
    // Either equals APP_VERSION (no commit, dev mode) or is APP_VERSION + '+' + commit.
    expect(APP_VERSION_FULL.split('+')[0]).toBe(APP_VERSION);
  });
});
