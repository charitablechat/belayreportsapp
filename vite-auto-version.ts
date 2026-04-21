import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { Plugin } from 'vite';

/**
 * Version strategy: read base "X.Y" from version.json, append the FULL git
 * commit count as the patch (monotonic, never wraps). The short commit hash
 * is exposed as a separate `build` field in /version.json so /version.json
 * stays a clean SemVer string while still being uniquely identifiable per
 * deploy.
 *
 * Format: {major}.{minor}.{commitCount}   e.g. 4.7.142
 * Build:  short commit hash                e.g. a3f29c1
 *
 * Why monotonic: the previous `(commits % 9) + 1` scheme caused version
 * collisions every 9 commits — different builds produced identical version
 * strings, so `isVersionNewer()` returned false and stale clients never
 * received update prompts. Monotonic patch + dist-only emission of
 * /version.json (no public/ mutation) eliminates this entire class of bug.
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

let warnedAboutGitFallback = false;

function getCommitCount(): number {
  try {
    const out = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim();
    const n = parseInt(out, 10);
    if (Number.isFinite(n) && n > 0) return n;
    throw new Error('git returned non-positive count');
  } catch {
    if (!warnedAboutGitFallback) {
      warnedAboutGitFallback = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[vite-auto-version] WARNING: git unavailable, using time-based fallback. ' +
          'Version numbers across builds may diverge unpredictably.'
      );
    }
    // Minutes since 2025-01-01 — guarantees uniqueness even without git.
    const epoch = new Date('2025-01-01T00:00:00Z').getTime();
    return Math.floor((Date.now() - epoch) / 60000);
  }
}

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'dev';
  }
}

function computeVersion(): string {
  const raw = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
  const base: string = raw.version || '1.0.0';
  const parts = base.split('.').map((p: string) => parseInt(p, 10));
  const major = Number.isFinite(parts[0]) ? parts[0] : 1;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  const patch = getCommitCount(); // monotonic, no modulo
  return `${major}.${minor}.${patch}`;
}

export function viteAutoVersion(): Plugin {
  let resolvedVersion = '0.0.0';
  let resolvedHash = 'dev';

  return {
    name: 'vite-auto-version',
    config() {
      resolvedVersion = computeVersion();
      resolvedHash = getCommitHash();
      const { buildDate, buildTimestamp } = generateTimestamp();

      // NOTE: We intentionally do NOT write public/version.json anymore.
      // The dist-emitted /version.json (see generateBundle) is the only
      // canonical copy at runtime. Mutating the source file caused builds
      // to clobber the committed value and produced confusing diffs.
      // In `vite dev`, Vite serves /version.json from the in-memory plugin
      // emit; if you run `vite preview` without a prior build, the route
      // 404s — that is expected.

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
    // Emit /version.json into the build output. Includes both the SemVer
    // string and the short commit hash so clients can disambiguate two
    // builds that happen to share major.minor.patch (shouldn't happen with
    // monotonic patch, but the hash is a belt-and-suspenders guarantee).
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
