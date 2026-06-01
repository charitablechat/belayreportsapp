#!/usr/bin/env node
/**
 * bump-version.mjs — increments version.json by one segment with a
 * single-digit 9-rollover policy:
 *
 *   4.8.0 → bump patch → 4.8.1 … → 4.8.9 → 4.9.0
 *   4.9.9 → bump patch → 5.0.0
 *   bump minor / bump major also supported
 *
 * Usage:
 *   node scripts/bump-version.mjs patch
 *   node scripts/bump-version.mjs minor
 *   node scripts/bump-version.mjs major
 *
 * Exits non-zero on invalid args or unparseable version.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = path.resolve(__dirname, '..', 'version.json');

/**
 * Pure bump function — exported logic, easy to unit-test.
 * Rolls a segment from 9 to 0 and carries +1 to the segment to its left.
 * Patch and minor are clamped to single-digit 0..9 (per product spec).
 * Major has no cap.
 */
export function bumpVersion(current, kind) {
  const parts = String(current).split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new Error(`Unparseable version: "${current}" (expected MAJOR.MINOR.PATCH)`);
  }
  let [maj, min, pat] = parts;

  if (kind === 'patch') {
    pat += 1;
    if (pat > 9) { pat = 0; min += 1; }
    if (min > 9) { min = 0; maj += 1; }
  } else if (kind === 'minor') {
    min += 1; pat = 0;
    if (min > 9) { min = 0; maj += 1; }
  } else if (kind === 'major') {
    maj += 1; min = 0; pat = 0;
  } else {
    throw new Error(`Unknown bump kind: "${kind}" (use patch|minor|major)`);
  }

  return `${maj}.${min}.${pat}`;
}

// CLI entrypoint — only runs when invoked directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  const kind = process.argv[2];
  if (!kind) {
    console.error('Usage: node scripts/bump-version.mjs <patch|minor|major>');
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
  const next = bumpVersion(raw.version, kind);
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: next }, null, 2) + '\n');
  console.log(`[bump-version] ${raw.version} → ${next}`);
}
