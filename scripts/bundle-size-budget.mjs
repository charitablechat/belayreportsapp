#!/usr/bin/env node
/**
 * Bundle-size budget gate.
 *
 * Mirrors the `lint:any-budget` pattern: a single integer file at
 * `.bundle-size-budget` defines the maximum total bytes of the
 * **eager first-load assets** (after `vite build`).
 *
 * Eager vs lazy: we parse `dist/index.html` and only count the JS/CSS
 * assets it directly references — the main entry chunk, its CSS, and
 * any modulepreload links. Code-split lazy chunks loaded via dynamic
 * `import()` (e.g. `pdfjs-dist` / `mammoth.browser` behind "Import
 * from previous report", per-route chunks, heic2any) are NOT counted.
 * They don't affect first-load cost and only download when the
 * relevant feature is used.
 *
 * Why total bytes, not gzipped: vite's deterministic output makes raw
 * size a stable signal; gzipping introduces variance from the gzip
 * implementation and adds a runtime dep. Raw bytes correlate well
 * enough with download size for the use-case (catching silent bloat
 * from a new dep landing in the eager bundle).
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

import { readFileSync, statSync, existsSync } from "node:fs";
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

// Parse dist/index.html for eager first-load assets only. Anything
// referenced via <script src>, <link rel="stylesheet" href>, or
// <link rel="modulepreload" href> is part of the first-paint cost.
// Dynamic-import chunks (lazy routes, pdfjs, mammoth, heic2any) are
// not referenced from index.html — they're emitted to dist/assets
// but only downloaded when the feature is invoked, so they don't
// count against the eager budget.
const indexHtmlPath = resolve(repoRoot, "dist/index.html");
if (!existsSync(indexHtmlPath)) {
  console.error(
    `[bundle-size-budget] ${indexHtmlPath} does not exist. Run \`bun run build\` first.`,
  );
  process.exit(2);
}
const indexHtml = readFileSync(indexHtmlPath, "utf8");
const eagerNames = new Set();
const assetRefRe = /\/assets\/([^"'\s>]+\.(?:js|css))/g;
let m;
while ((m = assetRefRe.exec(indexHtml)) !== null) {
  eagerNames.add(m[1]);
}

if (eagerNames.size === 0) {
  console.error(
    `[bundle-size-budget] No eager assets referenced from dist/index.html — refusing to pass a vacuous check.`,
  );
  process.exit(2);
}

let total = 0;
const top = [];
for (const name of eagerNames) {
  if (!TRACKED_EXT.has(extname(name))) continue;
  const full = join(assetsDir, name);
  if (!existsSync(full)) {
    console.error(
      `[bundle-size-budget] Eager asset ${name} referenced from index.html but missing on disk.`,
    );
    process.exit(2);
  }
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
