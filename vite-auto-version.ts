import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { parseVersion, getNextVersion, formatVersion } from './src/lib/version-calculator';

// NOTE: In the Lovable Cloud build environment, fs.writeFileSync does NOT persist
// between builds. The write-back to version.json is ephemeral—each build reads the
// committed version and increments +1 patch in memory only. To bump the version,
// manually update version.json and commit. Each build then displays that value + 1.
const VERSION_FILE = path.resolve(__dirname, 'version.json');
const TIMESTAMP_MARKER = path.resolve(__dirname, '.version-timestamp');
const DEBOUNCE_MS = 5000;

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

function shouldIncrement(): boolean {
  try {
    if (fs.existsSync(TIMESTAMP_MARKER)) {
      const lastTime = parseInt(fs.readFileSync(TIMESTAMP_MARKER, 'utf-8').trim(), 10);
      if (Date.now() - lastTime < DEBOUNCE_MS) {
        return false;
      }
    }
  } catch {
    // If marker is unreadable, proceed with increment
  }
  return true;
}

function writeMarker(): void {
  fs.writeFileSync(TIMESTAMP_MARKER, String(Date.now()));
}

export function viteAutoVersion(): Plugin {
  let versionDefines: Record<string, string> = {};

  return {
    name: 'vite-auto-version',
    config() {
      // Read current version
      const raw = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
      let currentVersion: string = raw.version;

      // Increment if debounce allows
      if (shouldIncrement()) {
        const next = getNextVersion(currentVersion);
        currentVersion = formatVersion(next, false);
        fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: currentVersion }, null, 2) + '\n');
        writeMarker();
      }

      const { buildDate, buildTimestamp } = generateTimestamp();

      versionDefines = {
        'import.meta.env.APP_VERSION': JSON.stringify(currentVersion),
        'import.meta.env.BUILD_DATE': JSON.stringify(buildDate),
        'import.meta.env.BUILD_TIMESTAMP': JSON.stringify(buildTimestamp),
      };

      return { define: versionDefines };
    },
  };
}
