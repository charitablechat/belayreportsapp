#!/usr/bin/env node
/**
 * Bundle-size budget gate.
 *
 * Mirrors the `lint:any-budget` pattern: a single integer file at
 * `.bundle-size-budget` defines the maximum total bytes of all
 * `dist/assets/*.js` and `dist/assets/*.css` files (after `vite build`).
 *
 * Why total bytes, not gzipped: vite's deterministic output makes raw
 * size a stable signal; gzipping introduces variance from the gzip
 * implementation and adds a runtime dep. Raw bytes correlate well
 * enough with download size for the use-case (catching silent bloat
 * from a new dep or accidental import).
 *
 * Why not per-file: heic2any alone is ~1.35 MB and is intentional.
 * A per-file gate would either be useless (set above heic2any, no
 * teeth on small chunks) or constantly trip on legitimate growth.
 * The total-bytes gate catches anything material.
 *
 * Why not gzipped + per-file: future work. Start simple; ratchet later.
 *
 * Behavior:
 *   - Exits 0 if total <= budget.
 *   - Exits 1 if total >  budget (with the diff and a ratchet hint).
 *   - Exits 2 on configuration error (missing budget file, missing
 *     `dist/assets`, etc.) — these are CI-side errors, not size regressions.
 *
 * Usage:
 *   bun run build && node scripts/bundle-size-budget.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, extname } from "node:path";
import { isLovableMainPush, emitLovableGraceWarning } from "./lovable-grace.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const budgetFile = resolve(repoRoot, ".bundle-size-budget");
const assetsDir = resolve(repoRoot, "dist/assets");

if (!existsSync(budgetFile)) {
  console.error(
    `[bundle-size-budget] Missing ${budgetFile}. Create it with a single integer (current total bytes).`,
  );
  process.exit(2);
}

const budget = parseInt(readFileSync(budgetFile, "utf8").trim(), 10);
if (!Number.isFinite(budget) || budget < 0) {
  console.error(
    `[bundle-size-budget] ${budgetFile} must contain a non-negative integer.`,
  );
  process.exit(2);
}

if (!existsSync(assetsDir)) {
  console.error(
    `[bundle-size-budget] ${assetsDir} does not exist. Run \`bun run build\` first.`,
  );
  process.exit(2);
}

// Small tolerance to absorb deterministic-ish noise from build-time
// constants embedded in the bundle: APP_VERSION (vite-auto-version.ts
// injects the git SHA), source-map filename hashes, etc. A CI build
// from a different commit than local produces ~10–100 B of variance
// even with no source changes. 4 KiB is well below any meaningful
// regression but absorbs the noise floor.
const TOLERANCE_BYTES = 4 * 1024;

const TRACKED_EXT = new Set([".js", ".css"]);
const entries = readdirSync(assetsDir);
let total = 0;
const top = [];
for (const name of entries) {
  if (!TRACKED_EXT.has(extname(name))) continue;
  const full = join(assetsDir, name);
  const st = statSync(full);
  if (!st.isFile()) continue;
  total += st.size;
  top.push({ name, size: st.size });
}

top.sort((a, b) => b.size - a.size);

const fmt = (n) => `${n.toLocaleString()} B (${(n / 1024).toFixed(1)} KiB)`;

console.log(`[bundle-size-budget] tracked-files: ${top.length}`);
console.log(
  `[bundle-size-budget] total: ${fmt(total)}  budget: ${fmt(budget)}  tolerance: ${fmt(TOLERANCE_BYTES)}`,
);
console.log(`[bundle-size-budget] top 5:`);
for (const { name, size } of top.slice(0, 5)) {
  console.log(`  ${fmt(size).padStart(28)}  ${name}`);
}

const ceiling = budget + TOLERANCE_BYTES;
if (total > ceiling) {
  const over = total - budget;
  const failMessage = `bundle is ${fmt(over)} over budget (${fmt(TOLERANCE_BYTES)} tolerance allowed). Total: ${fmt(total)}, budget: ${fmt(budget)}.`;
  if (isLovableMainPush()) {
    emitLovableGraceWarning("bundle-size-budget", failMessage);
    process.exit(0);
  }
  console.error(`\n[bundle-size-budget] FAIL — ${failMessage}`);
  console.error(
    "If this is intentional (e.g. you added a new feature with vendored",
  );
  console.error(
    "code that earns the size), raise the budget in .bundle-size-budget",
  );
  console.error(
    `to ${total} — reviewers can see the bump in the diff and gate it.`,
  );
  console.error(
    "\nThe preferred fix is to look at the top-5 above for accidental",
  );
  console.error(
    "imports (e.g. importing the full lodash instead of lodash/get).",
  );
  process.exit(1);
}

// Ratchet hint only when we're meaningfully below the budget (i.e. a
// real cleanup, not just CI/local noise within the tolerance band).
if (total < budget - TOLERANCE_BYTES) {
  console.log(
    `[bundle-size-budget] \u{1F389} bundle dropped below budget. Lower .bundle-size-budget to ${total} to ratchet the gate.`,
  );
}

process.exit(0);
