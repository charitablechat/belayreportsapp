import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { Plugin } from 'vite';

/**
 * Version strategy: read base "X.Y" from version.json, append a patch derived
 * from git commit count so EVERY deploy advances the version automatically.
 * No file write-back required — works in ephemeral CI environments like
 * Lovable Cloud where filesystem changes don't persist between builds.
 *
 * Format: v{major}.{minor}.{(commitCount % 9) + 1}  → patch ranges 1–9
 * (matches the existing rollover scheme where .10 wraps to .1)
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

function getCommitCount(): number {
  try {
    const out = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Fall back to a time-based pseudo-counter so version still advances
    // (minutes since 2025-01-01) — guarantees no two builds share a version.
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
  const commits = getCommitCount();
  const patch = (commits % 9) + 1; // 1..9
  return `${major}.${minor}.${patch}`;
}

export function viteAutoVersion(): Plugin {
  let resolvedVersion = '0.0.0';

  return {
    name: 'vite-auto-version',
    config() {
      resolvedVersion = computeVersion();
      const hash = getCommitHash();
      const { buildDate, buildTimestamp } = generateTimestamp();

      // Also write public/version.json so dev server + any code path that
      // reads it from the source tree (not just dist) sees the live version.
      // Without this, public/version.json stays frozen at whatever was last
      // committed and the deployed-version comparison is meaningless.
      try {
        const publicVersionPath = path.resolve(__dirname, 'public/version.json');
        fs.writeFileSync(
          publicVersionPath,
          JSON.stringify({ version: resolvedVersion }, null, 2) + '\n',
          'utf-8'
        );
      } catch {
        // non-fatal — generateBundle still emits into dist
      }

      return {
        define: {
          'import.meta.env.APP_VERSION': JSON.stringify(resolvedVersion),
          'import.meta.env.BUILD_DATE': JSON.stringify(buildDate),
          'import.meta.env.BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
          'import.meta.env.BUILD_COMMIT': JSON.stringify(hash),
        },
      };
    },
    // Emit /version.json into the build output with the FULL computed version.
    // The static file at public/version.json holds the BASE only — this
    // overwrites it in the dist with the resolved patch so client-side stale
    // checks compare apples to apples.
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: resolvedVersion }, null, 2) + '\n',
      });
    },
  };
}

