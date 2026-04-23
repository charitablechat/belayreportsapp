

## S24 — Robust user-facing label in sync progress emitter

**Problem.** `src/lib/atomic-sync-manager.ts` builds the progress label as `${inspection.organization} - ${inspection.location}`. When `organization` is missing/empty, users see `" - Lake Wylie, SC"`. When both are missing, they see `" - "`.

### Design

Add a small `formatProgressLabel(parts: (string | null | undefined)[], fallback: string)` helper that:
- Trims each part, filters empty/nullish values.
- Joins remaining parts with `" - "`.
- Returns `fallback` if nothing is left.

### Files

- **`src/lib/atomic-sync-manager.ts`** — Inline the helper (or define at module top). Replace the four lines 843–851 label-building expression with:
  ```ts
  const label = formatProgressLabel(
    [inspection.organization, inspection.location],
    'Untitled inspection'
  );
  ```
  Apply the same pattern to the analogous emitter blocks for trainings (org + location → fallback `'Untitled training'`) and daily assessments (org + date → fallback `'Untitled assessment'`) if they exhibit the same concatenation bug — quick grep first.

### Out of scope

- Changing the progress payload shape or `SyncProgress` type.
- Translating/i18n the fallback strings.

### Risk

Trivial. Pure string formatting; no behavioral or persistence change.

### Verification

`npx tsc --noEmit`. Manually trigger a sync of a record where `organization` is empty; confirm the toast shows `Untitled inspection` (or just the location) instead of a leading `" - "`.

