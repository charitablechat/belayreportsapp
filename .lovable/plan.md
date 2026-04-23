

## S35 — Delete dead deprecated sync functions

### Finding

`syncInspections`, `syncDailyAssessments`, and `syncTrainings` in `src/lib/sync-manager.ts` (L61–96) are throw-on-call stubs marked `@deprecated`. A repo-wide grep across all `.ts`/`.tsx` files turns up zero callers — every match is the declaration or its own throw-message text. They're pure dead code: no TS error guards them, but nothing reaches them either.

### Fix

Delete the three function blocks (and their `@deprecated` JSDoc) entirely from `src/lib/sync-manager.ts`. Lines 61–96 go away. The file becomes:

```
[L1-58]  classifyPhotoError + types  (unchanged)
[L59]    blank line
[L60+]   // Photo sync manager - still valid, not deprecated
         import { runWithConcurrency } ...
         (rest of file unchanged)
```

No other file changes — `atomic-sync-manager.ts` already owns the canonical entry points (`syncAllInspectionsAtomic`, `syncAllTrainingsAtomic`, `syncAllDailyAssessmentsAtomic`) and `useAutoSync` already calls those.

### Out of scope

- Renaming or restructuring `sync-manager.ts` (still hosts `syncPhotos` + `classifyPhotoError`, both live).
- Touching `atomic-sync-manager.ts`.

### Risk

None. The functions throw on call today, so removing them can only convert a (currently impossible) runtime crash into a (currently impossible) TS compile error — strictly safer. The grep proves no live caller exists.

### Verification

- `npx tsc --noEmit` passes.
- Repo grep `syncInspections\|syncTrainings\|syncDailyAssessments` returns zero matches after the edit.
- Manual: trigger a sync; existing atomic flow runs unchanged.

