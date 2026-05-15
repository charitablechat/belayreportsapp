
# Production-Readiness Cleanup — Sequenced Plan

Workflow contract: each step pauses for your "go ahead" before the next. After every file change, the relevant Vitest suite must pass (or the step does not count as done).

---

## Step 0 — Baseline (no code changes)

Run the full suite to capture ground truth before changing anything.

```
bun run test 2>&1 | tee /tmp/baseline-vitest.log
bun run test src/lib/__tests__/photo-sync-temp-parent.test.ts 2>&1 | tee /tmp/photo-sync-isolated.log
```

Report back:
- Total pass/fail counts.
- Exact failing assertion(s) and stack for `photo-sync-temp-parent.test.ts` in both modes (full suite vs isolated).
- Any other red files (so we know what we're walking into for later steps).

**Pause for your go-ahead** before Step 1.

---

## Step 1 — Security: replace `xlsx` with `exceljs`

Scope: only the two consumers + `package.json`.
- `src/lib/backup-export.ts` — `downloadBackupAsExcel`, `downloadBackupAsCsv`.
- Anything else `rg "from \"xlsx\"" src` finds (will be confirmed before edits).

Approach:
1. `bun add exceljs` and `bun add -d @types/node` (already present).
2. `bun remove xlsx`.
3. Rewrite the two helpers using `ExcelJS.Workbook` for `.xlsx`. For the CSV ZIP path, replace `XLSX.utils.sheet_to_csv` with a small in-house JSON-to-CSV (≈15 lines, RFC-4180 quoting) so we don't need a second library.
4. Add a focused unit test: `src/lib/__tests__/backup-export.test.ts` that round-trips a known `BackupData` shape through both helpers and asserts the output ZIP / Workbook structure (sheet names, header row, first data row).
5. Run `bun run test src/lib/__tests__/backup-export.test.ts` and `bun run test` (full suite — must stay green).

**Pause** for go-ahead before Step 2.

---

## Step 2 — Stability: photo-sync-temp-parent

I will not write a fix until Step 0 shows me the actual failure. The fix proposal (mock shape, IDB seeding, or production code change) lands in this step's plan revision after baseline.

Acceptance: `bun run test src/lib/__tests__/photo-sync-temp-parent.test.ts` green in isolation **and** in the full suite.

---

## Step 3 — Architecture: form decomposition (one form at a time)

Order: `TrainingForm.tsx` → `DailyAssessmentForm.tsx` → `InspectionForm.tsx` (largest last so we apply lessons learned). Each form gets its own pause point.

For `TrainingForm.tsx` (2,269 LOC), target split:

```
src/pages/TrainingForm.tsx                (orchestrator, ≤300 LOC: routing, RHF root, layout)
src/components/training/
  TrainingHeaderSection.tsx               (header fields, attestation status)
  TrainingParticipantsSection.tsx         (roster table)
  TrainingTopicsSection.tsx               (curriculum + comments)
  TrainingEquipmentSection.tsx
  TrainingSummarySection.tsx              (auto-generated summary, race-aware)
  TrainingFooterActions.tsx               (Save / Complete / Sign)
src/lib/form-loaders/
  trainingLoader.ts                       (IDB read, server reconcile, mergeLocal helpers)
  trainingSaver.ts                        (debounced save, immediate-save flush, sync hand-off)
  trainingValidation.ts                   (re-export from existing validation-schemas)
```

Hard rules:
- No behavioural changes — pure mechanical extraction. Snapshot any inline helpers into the loader/saver modules verbatim, then re-export.
- Every section receives `control` (RHF), `disabled`, and section-scoped callbacks; no prop-drilling of the entire form value object.
- Memo each section with `React.memo` to stop the re-render storm.
- Preserve all memory contracts — especially `notes-onblur-immediate-save`, `dropdown-commit-immediate-save`, `autocomplete-select-defer-onblur`, `training-summary-generation-race`.

Verification per form:
1. `bun run test` (full vitest suite) — green.
2. `bun run test:e2e:smoke` — green.
3. Manual smoke checklist (I'll generate one and you confirm) covering: load existing training → edit a topic → blur (save fires) → reload → values persist; offline edit → online → no duplicate.

**Pause** after each form before starting the next.

---

## Step 4 — Safety Gates: any-budget + strictNullChecks

Phase A — ratchet `.eslint-any-budget`:
1. Run `npx eslint . -f json | node -e "..."` to count current `no-explicit-any` violations.
2. Set `.eslint-any-budget` to `current_count` exactly (no slack). Commit.

Phase B — `strictNullChecks` for `src/lib/**` only, gradually:
1. Create `tsconfig.lib-strict.json` extending app config with `strictNullChecks: true` and `include: ["src/lib/**/*"]`. Add `bun run typecheck:lib-strict` script.
2. Run it; capture full error list.
3. Fix file-by-file in dependency order (leaves first: `date-utils`, `file-ext`, `password-strength`, …; roots last: `offline-storage`, `atomic-sync-manager`).
4. Allowed remediations only:
   - Narrow types (`string | undefined` → guard then use).
   - Early-return guards: `if (!x) return;`.
   - Explicit fallbacks: `x ?? defaultValue`.
   - Discriminated-union refactor when a function genuinely returns two shapes.
5. Forbidden: `!` non-null assertion, `as Foo` casts that hide null, `any`, `@ts-ignore`. `@ts-expect-error` only with a justifying comment and a linked TODO.
6. Per file: run vitest for tests touching that file (`bun run test <pattern>`), then full suite at end of phase.

If a file resists clean fixing → stop, leave it out of the strict include list, add it to a `STRICT_NULL_BLOCKERS.md` report for you to triage during Step 3 form decomposition.

Phase C — extend strictness to `src/hooks/**`, then `src/components/**`, then flip `strictNullChecks: true` repo-wide. Each phase paused for go-ahead.

---

## Step 5 — Reliability: retry helper for `await import()`

New module:

```ts
// src/lib/dynamic-import.ts
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_MS = 300;

export async function dynamicImport<T>(
  loader: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await loader();
    } catch (err) {
      lastErr = err;
      // ChunkLoadError shape across bundlers — always retryable.
      const name = (err as { name?: string } | null)?.name ?? "";
      const msg  = (err as { message?: string } | null)?.message ?? "";
      const retryable =
        name === "ChunkLoadError" ||
        /Loading (CSS )?chunk \d+ failed/.test(msg) ||
        /Failed to fetch dynamically imported module/.test(msg) ||
        /error loading dynamically imported module/.test(msg);
      if (!retryable || i === attempts - 1) break;
      const jitter = Math.random() * baseMs;
      await new Promise(r => setTimeout(r, baseMs * 2 ** i + jitter));
    }
  }
  throw lastErr;
}
```

Migration:
1. Find every `await import(` and `import(` returning a promise: `rg -n "(?<!type )\bimport\(" src`.
2. Wrap each with `dynamicImport(() => import("..."))`. Skip type-only `import()` (TS types).
3. Add unit tests: success on first try, success on second try after one ChunkLoadError, failure after exhausting attempts, non-retryable error rethrown immediately.
4. Add `dynamicImport` to the ESLint allow-list and add a custom rule (or grep-based CI check) that fails if a bare `await import(` shows up under `src/`.

Verification: full vitest + `test:e2e:smoke`.

---

## Closing Gate

Before declaring the cleanup done:
- `bun run test` — 100% green.
- `bun run test:e2e:smoke` — green.
- `bun run lint` — clean.
- `bun run lint:any-budget` — under budget.
- `bun run bundle-size:budget` — under budget (likely smaller after `xlsx` → `exceljs`).
- A short delta report from me: bundle size before/after, any-count before/after, strict-null files in scope.

---

**My next action, on your go-ahead:** execute Step 0 only and report the baseline.
