## Cleanup pass: 168 pre-existing TypeScript errors

### Scope

`tsc -p tsconfig.app.json --noEmit` currently reports **168 errors across 13 files**. None block dev-mode preview (Vite uses esbuild and ignores types), but they break the production typecheck and pollute IDE feedback. All errors trace back to **two root-cause type tweaks** made earlier in the codebase that were never propagated to the call sites.

### Root causes

**Cause A — overly strict signatures on `offline-storage.ts` writers**
Four functions require an exact-shape parent argument:

```ts
inspection: Record<string, unknown> & { id: string; child_count_hint?: number; dirty?: boolean }
training:   Record<string, unknown> & { id: string; … }
assessment: Record<string, unknown> & { id: string; … }
photo:      Record<string, unknown> & { id: string; inspectionId: string; uploaded?: unknown }
```
Plus child writers want `Record<string, unknown>[]` arrays, but every caller has either `DbRow` (where `id` is optional) or `unknown[]`. This produces ~120 of the 168 errors.

**Cause B — `DbRow` has `id?: string` (optional)**
Defined in `offline-storage.ts` as `Record<string, unknown> & { id?: string }`. Loops in `atomic-sync-manager.ts`, `Dashboard.tsx`, etc. read `row.id`, `row.synced_at`, `row.organization_id` — every property is `unknown`, breaking dozens of `string` parameters and date constructors.

### Fix strategy (two surgical edits, no behavior change)

**Edit 1 — relax the four writer signatures in `src/lib/offline-storage.ts`:**

```ts
// before:  Record<string, unknown> & { id: string; child_count_hint?: number; dirty?: boolean }
// after:   Record<string, unknown> & { id?: string; child_count_hint?: number; dirty?: boolean }

// child writers: Record<string, unknown>[]  →  Array<Record<string, unknown>>
// (drop the index-signature requirement that rejects `unknown[]`)
```
Runtime is unchanged — these functions already validate `id` internally. Only the type contract loosens to match what callers actually have. This dissolves ~120 errors.

**Edit 2 — narrow `DbRow` for known string fields in `src/lib/offline-storage.ts`:**

```ts
// before: export type DbRow = Record<string, unknown> & { id?: string };
// after:  export type DbRow = Record<string, unknown> & {
//           id?: string;
//           updated_at?: string;
//           synced_at?: string;
//           organization?: string;
//           organization_id?: string;
//           inspection_id?: string;
//         };
```
These six fields are read as strings throughout the sync pipeline. Adding them to the type matches reality (the IDB rows do hold strings) and dissolves the remaining `TS2769`/`TS2339`/`TS2559`/`TS2322` errors in `atomic-sync-manager.ts`, `Dashboard.tsx`, `local-backup-ledger.ts`, `queued-soft-delete-processor.ts`, etc.

**Residual cast cleanup (≤8 sites)** in `InspectionForm.tsx`, `DailyAssessmentForm.tsx`, `TrainingForm.tsx`: a few `setSummary(parsedRow)` calls expect a fully-typed summary object but get a raw `DbRow`. Add a single `as` cast at each call site (consistent with existing patterns in those files).

**Plus 7 errors in `cached-auth.ts`**: `User` from supabase-js lacks the index signature `CachedUser` requires. Fix by changing one type assertion at the bridge function (already a known glue point — ~3-line edit).

### Files touched

| File | Change |
|---|---|
| `src/lib/offline-storage.ts` | Relax 4 writer signatures + extend `DbRow` |
| `src/lib/cached-auth.ts` | One cast at User→CachedUser bridge |
| `src/pages/InspectionForm.tsx` | ~4 narrow casts on summary row reads |
| `src/pages/TrainingForm.tsx` | ~2 narrow casts |
| `src/pages/DailyAssessmentForm.tsx` | ~2 narrow casts |

No changes to `atomic-sync-manager.ts`, `local-backup-ledger.ts`, `Dashboard.tsx`, `queued-soft-delete-processor.ts`, `transaction-manager.ts`, or other libs — they get fixed transitively by the type-definition edits.

### Verification

After edits, run `npx tsc -p tsconfig.app.json --noEmit` and confirm zero errors. No test changes — these are pure type adjustments, runtime untouched.

### Risk

Low. Loosening `id: string` to `id?: string` in writer signatures is a strict superset (more inputs accepted, same runtime). Adding optional string fields to `DbRow` only narrows downstream `unknown` to `string | undefined` — any code that relied on `unknown` still compiles. No public API or schema change.

### Out of scope

- Edge-function build errors (`generate-inspection-html`, `web-push@3.6.6`, `pdf-parse@1.1.1`) — separate Deno runtime, not part of this typecheck pass.
- The tightened any-budget lint rule.

### Verdict

Approve and I'll switch to default mode and ship the type-definition edits + ~10 call-site casts in one round.