import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { Plugin } from 'vite';
import { bumpVersion } from './scripts/bump-version.mjs';

/**
 * Version strategy (rewritten 2026-06):
 *
 *   - `version.json` is the single source of truth: { "version": "MAJOR.MINOR.PATCH" }.
 *   - On a PRODUCTION build (`mode === 'production'`), the plugin auto-increments
 *     the patch with a single-digit 9-rollover (4.8.0 → 4.8.1 … → 4.8.9 → 4.9.0,
 *     then 4.9.9 → 5.0.0) and writes the new value back to version.json so the
 *     committed file always reflects the most recently shipped version.
 *   - On dev / preview / non-prod builds, the version is read as-is (no bump),
 *     so running `vite dev` does not churn the file.
 *   - The short git commit hash is still exposed as `BUILD_COMMIT` for Sentry
 *     release tagging and audit-row traceability, but it is no longer part of
 *     the user-visible version string.
 *
 * Why this replaced the old "patch = git rev-list count" scheme: that produced
 * 6-digit patches like `4.7.743127` because Lovable's commit count includes
 * internal commits. The numbers were monotonic and collision-free but visually
 * impossible to scan. Manual short SemVer + 9-rollover keeps every deploy
 * unique while staying human-readable; the comparator in `version-check.ts`
 * already handles SemVer correctly so the stale-build banner and min-version
 * policy continue to work unchanged.
 */
const VERSION_FILE = path.resolve(__dirname, 'version.json');

function generateTimestamp(): { buildDate: string; buildTimestamp: string } {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Chicago',
  });

  const buildDate = dateFormatter.format(now).replace(/\//g, '-');
  const timePart = timeFormatter.format(now);
  const buildTimestamp = `${buildDate} at ${timePart} CST`;

  return { buildDate, buildTimestamp };
}

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'dev';
  }
}

function readVersion(): string {
  const raw = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
  const v = typeof raw?.version === 'string' ? raw.version : '0.0.0';
  // Sanity-check shape; fall back to "0.0.0" rather than crash the build.
  if (!/^\d+\.\d+\.\d+$/.test(v)) return '0.0.0';
  return v;
}

function writeVersion(next: string): void {
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: next }, null, 2) + '\n');
}

export function viteAutoVersion(): Plugin {
  let resolvedVersion = '0.0.0';
  let resolvedHash = 'dev';

  return {
    name: 'vite-auto-version',
    config(_userConfig, env) {
      const current = readVersion();

      // Auto-bump patch on production builds only. Dev / preview reads as-is.
      if (env.command === 'build' && env.mode === 'production') {
        try {
          resolvedVersion = bumpVersion(current, 'patch');
          writeVersion(resolvedVersion);
        } catch (err) {
          // If the bump fails for any reason, fall back to the current value
          // rather than blocking the build. The build will still produce a
          // working bundle; the version just won't tick up this deploy.
          console.warn('[vite-auto-version] bump failed, using current version:', err);
          resolvedVersion = current;
        }
      } else {
        resolvedVersion = current;
      }

      resolvedHash = getCommitHash();
      const { buildDate, buildTimestamp } = generateTimestamp();

      return {
        define: {
          'import.meta.env.APP_VERSION': JSON.stringify(resolvedVersion),
          'import.meta.env.BUILD_DATE': JSON.stringify(buildDate),
          'import.meta.env.BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
          'import.meta.env.BUILD_COMMIT': JSON.stringify(resolvedHash),
        },
      };
    },
    // Serve /version.json in dev so the app can poll it without a build step.
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({ version: resolvedVersion, build: resolvedHash }, null, 2) + '\n'
        );
      });
    },
    // Emit /version.json into the build output. Build hash stays as a
    // secondary tiebreaker for diagnostics; the visible version is the
    // short SemVer string.
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source:
          JSON.stringify({ version: resolvedVersion, build: resolvedHash }, null, 2) + '\n',
      });
    },
  };
}
