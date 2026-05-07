// Smoke test for scripts/lovable-grace.mjs `isLovableMainPush()` detection.
//
// Not part of the vitest suite (vitest doesn't pick up scripts/ by default
// and this is a tiny pure-Node helper). Run with `node` directly:
//   node scripts/__tests__/lovable-grace.smoke.mjs
//
// Exits 0 on all-pass, 1 on any failure.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
const cases = [];

async function withMockedEnv(env, fn) {
  const original = { ...process.env };
  // Wipe relevant env vars so cases are independent.
  for (const key of [
    "GITHUB_ACTOR",
    "GITHUB_EVENT_NAME",
    "GITHUB_REF",
    "GITHUB_EVENT_PATH",
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
}

function makeEventFile(payload) {
  const dir = mkdtempSync(join(tmpdir(), "lovable-grace-test-"));
  const path = join(dir, "event.json");
  writeFileSync(path, JSON.stringify(payload), "utf-8");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function run(name, env, makePayload, expected) {
  cases.push(name);
  // Fresh import so module-level state doesn't leak between cases. Cache-bust
  // by appending a timestamp query so node re-reads the file each invocation.
  const mod = await import(
    `../lovable-grace.mjs?cache=${Date.now()}-${Math.random()}`
  );
  let cleanup = () => {};
  const fullEnv = { ...env };
  if (makePayload) {
    const { path, cleanup: c } = makeEventFile(makePayload());
    fullEnv.GITHUB_EVENT_PATH = path;
    cleanup = c;
  }
  try {
    const actual = await withMockedEnv(fullEnv, () => mod.isLovableMainPush());
    if (actual !== expected) {
      console.error(
        `  FAIL ${name}: expected ${expected}, got ${actual}`,
      );
      failures += 1;
    } else {
      console.log(`  PASS ${name}`);
    }
  } finally {
    cleanup();
  }
}

await run(
  "Lovable push to main → true",
  {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: "charitablechat", // Note: NOT the bot — this is the bug PR #155 hit.
  },
  () => ({
    head_commit: {
      author: {
        name: "gpt-engineer-app[bot]",
        email:
          "159125892+gpt-engineer-app[bot]@users.noreply.github.com",
      },
    },
  }),
  true,
);

await run(
  "Human push to main → false",
  {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: "charitablechat",
  },
  () => ({
    head_commit: {
      author: { name: "Belay", email: "kale@belayreports.com" },
    },
  }),
  false,
);

await run(
  "Lovable push to feature branch → false (not main)",
  {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/devin/some-branch",
    GITHUB_ACTOR: "charitablechat",
  },
  () => ({
    head_commit: { author: { name: "gpt-engineer-app[bot]" } },
  }),
  false,
);

await run(
  "Pull request event (even with Lovable head_commit) → false",
  {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REF: "refs/pull/42/merge",
    GITHUB_ACTOR: "charitablechat",
  },
  () => ({
    head_commit: { author: { name: "gpt-engineer-app[bot]" } },
  }),
  false,
);

await run(
  "Missing GITHUB_EVENT_PATH → false (defensive: don't downgrade unknown)",
  {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: "gpt-engineer-app[bot]",
  },
  null,
  false,
);

await run(
  "Malformed event payload (no head_commit) → false",
  {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: "charitablechat",
  },
  () => ({ random: "garbage" }),
  false,
);

console.log("");
if (failures > 0) {
  console.error(`${failures}/${cases.length} cases failed`);
  process.exit(1);
} else {
  console.log(`${cases.length}/${cases.length} cases passed`);
  process.exit(0);
}
