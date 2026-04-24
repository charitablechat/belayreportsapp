#!/usr/bin/env node
/**
 * N-D — "no-explicit-any" lint budget gate.
 *
 * The audit flagged net-new `any` usage creeping into the codebase on every
 * PR (1029 → 1364 errors over recent waves). A blanket ban would require a
 * ~4-day refactor; gating *new* additions is both achievable today and the
 * right long-term ratchet.
 *
 * This script:
 *   1. Runs eslint in JSON mode.
 *   2. Counts `@typescript-eslint/no-explicit-any` errors.
 *   3. Compares against `.eslint-any-budget` (plain integer file).
 *   4. Exits 1 if the count exceeds the budget; exits 0 otherwise.
 *
 * To lower the budget after a cleanup, edit `.eslint-any-budget`. To
 * temporarily allow a net-new `any`, raise the budget explicitly — the
 * change is tracked in the diff and is visible to reviewers.
 *
 * Usage:
 *   node scripts/lint-any-budget.mjs
 *
 * Designed to run in CI (add to `npm run lint:ci`) and optionally locally
 * via lint-staged. No husky / lint-staged dependency required.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const budgetFile = resolve(repoRoot, ".eslint-any-budget");

if (!existsSync(budgetFile)) {
  console.error(
    `[lint-any-budget] Missing ${budgetFile}. Create it with a single integer (current any-count).`,
  );
  process.exit(2);
}

const budget = parseInt(readFileSync(budgetFile, "utf8").trim(), 10);
if (!Number.isFinite(budget) || budget < 0) {
  console.error(
    `[lint-any-budget] ${budgetFile} must contain a non-negative integer.`,
  );
  process.exit(2);
}

console.log(`[lint-any-budget] Running eslint…`);
const eslint = spawnSync(
  "npx",
  ["eslint", ".", "-f", "json"],
  { cwd: repoRoot, encoding: "utf8", maxBuffer: 200 * 1024 * 1024 },
);

// eslint exits non-zero whenever it finds any error; that is expected here.
// We only bail out if eslint itself crashed (no stdout at all).
if (!eslint.stdout) {
  console.error(
    "[lint-any-budget] eslint produced no output. stderr:\n" +
      (eslint.stderr || "<empty>"),
  );
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(eslint.stdout);
} catch (err) {
  console.error("[lint-any-budget] Failed to parse eslint JSON output:", err);
  process.exit(2);
}

let actual = 0;
for (const file of parsed) {
  for (const msg of file.messages || []) {
    if (msg.ruleId === "@typescript-eslint/no-explicit-any") actual++;
  }
}

console.log(`[lint-any-budget] any-errors: ${actual}  budget: ${budget}`);

if (actual > budget) {
  console.error(
    `\n[lint-any-budget] FAIL — found ${actual - budget} net-new @typescript-eslint/no-explicit-any error(s).`,
  );
  console.error(
    "If this is intentional (e.g. you lowered coverage elsewhere by more than you added),",
  );
  console.error(
    `raise the budget in .eslint-any-budget to ${actual} — reviewers can see the bump in the diff.`,
  );
  console.error(
    "The preferred fix is to type the new code properly or use 'unknown' with a type guard.",
  );
  process.exit(1);
}

if (actual < budget) {
  console.log(
    `[lint-any-budget] \u{1F389} count dropped below the budget. Lower .eslint-any-budget to ${actual} to ratchet the gate.`,
  );
}

process.exit(0);
