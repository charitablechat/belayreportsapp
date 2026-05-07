import { appendFileSync, readFileSync } from "node:fs";

/**
 * Lovable-aware CI grace mode.
 *
 * Lovable (the AI builder, identified as `gpt-engineer-app[bot]` on GitHub)
 * pushes UI/feature changes directly to `main` without going through a PR.
 * Our `lint:any-budget` and `bundle-size:budget` gates are by design
 * paranoid — any net-new `any` cast or any meaningful bundle growth fails
 * the build. When Lovable's natural workflow trips them, main goes red and
 * a `main-broken` issue is filed (PR #24 alert), even though the underlying
 * commit is a legitimate, intended change from the product owner's
 * perspective.
 *
 * This helper detects that case so the gates can downgrade from FAIL to a
 * surfaced WARNING for Lovable-authored direct pushes to main. The gates
 * still FAIL for:
 *   - All pull-request triggers (so engineering PRs and external
 *     contributors are held to the budgets).
 *   - All non-Lovable pushes to main (so a human pushing directly to main
 *     in an emergency still gets the gate).
 *
 * Lovable's bumps are surfaced separately by `lovable-daily-digest.yml`,
 * which scans the last 24h of main commits, lists overshoots, and opens or
 * updates a tracking issue so the team has visibility into the cumulative
 * cost without main going red on every push.
 *
 * Detection signal: head-commit author identity matches `gpt-engineer-app[bot]`
 * AND GITHUB_EVENT_NAME=push AND GITHUB_REF=refs/heads/main. We read the
 * head-commit author from `$GITHUB_EVENT_PATH` (the JSON event payload
 * GitHub Actions writes to disk for every run) rather than `GITHUB_ACTOR`,
 * because `GITHUB_ACTOR` resolves to the OWNER of the app installation
 * (a human account) when a GitHub App pushes via its installation token,
 * NOT the bot login. PR #155's first attempt keyed off `GITHUB_ACTOR`
 * and silently never matched on Lovable's pushes — caught when the
 * `main-broken-alert` workflow kept firing on commit `66bcd02` even
 * though the gate was supposed to downgrade for it.
 */

const LOVABLE_BOT_ACTOR = "gpt-engineer-app[bot]";

/**
 * Reads the head-commit author name from the GitHub Actions event payload.
 * Returns null if the payload is unavailable or the field is missing
 * (e.g. running locally, on a non-push event without head_commit, or in
 * a malformed environment).
 */
function readHeadCommitAuthorName() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  try {
    const payload = JSON.parse(readFileSync(eventPath, "utf-8"));
    // For push events the field is `head_commit.author.{name,email,username}`.
    // We use `name` because git's `%an` directly matches it for Lovable's
    // commits (`gpt-engineer-app[bot]`).
    const name = payload?.head_commit?.author?.name;
    return typeof name === "string" ? name : null;
  } catch {
    // Best-effort: unreachable file, parse error, etc. Fall through to
    // the gate's default FAIL behaviour rather than silently downgrading.
    return null;
  }
}

/**
 * Returns true when the gate should downgrade FAIL → WARN for this
 * particular CI run.
 */
export function isLovableMainPush() {
  if (process.env.GITHUB_EVENT_NAME !== "push") return false;
  if (process.env.GITHUB_REF !== "refs/heads/main") return false;
  return readHeadCommitAuthorName() === LOVABLE_BOT_ACTOR;
}

/**
 * Common message template so the bypass is clearly labelled in the CI log
 * AND in the GitHub step summary surface (logged to GITHUB_STEP_SUMMARY
 * if available, which renders in the Actions run page UI).
 */
export function emitLovableGraceWarning(gateName, detail) {
  const banner = `[${gateName}] LOVABLE-GRACE — would-fail gate downgraded to warning for direct push to main by ${LOVABLE_BOT_ACTOR}`;
  console.warn(banner);
  console.warn(detail);
  console.warn(
    "[lovable-grace] This overshoot will be surfaced in the daily digest issue (label: lovable-budget-overshoot).",
  );
  console.warn(
    "[lovable-grace] Engineering PRs are still held to the budgets — see scripts/lovable-grace.mjs.",
  );

  // Append a structured note to the GitHub Actions run summary so anyone
  // clicking the run sees the bypass without having to expand job logs.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const sha = (process.env.GITHUB_SHA || "").slice(0, 7);
    const md = [
      `## ⚠️ Lovable-grace bypass — \`${gateName}\``,
      "",
      `**Commit:** \`${sha}\` (push by \`${LOVABLE_BOT_ACTOR}\`)`,
      `**Gate:** \`${gateName}\` would have failed but was downgraded to a warning.`,
      "",
      `**Detail:**`,
      "",
      "```",
      detail,
      "```",
      "",
      "Engineering PRs are still held to the budgets — see `scripts/lovable-grace.mjs`. The daily `Lovable daily digest` workflow tracks running totals.",
      "",
    ].join("\n");
    try {
      appendFileSync(summaryPath, md);
    } catch {
      // Best-effort: the warning has already been logged to stderr.
    }
  }
}
