## Block "Complete" until required header fields are filled

Saving stays unrestricted (drafts can be empty). The **Complete** action is the only new gate, with three signals when it's blocked: rejection, persistent toast at top of screen, and a red pulse on the offending field(s).

### Required fields per report

Sourced from the existing zod schemas — no new rules introduced:

| Report | Required header fields |
|---|---|
| Inspection | `organization`, `location`, `inspection_date` |
| Training | `organization` (Training Site), `start_date`, `end_date` |
| Daily Assessment | `organization`, `assessment_date` |

(Attestation signature stays gated separately — already wired.)

### New shared helper — `src/lib/required-fields.ts`

Single source of truth so the three forms can't drift:

```ts
export type MissingField = { key: string; label: string };

export function getMissingInspectionFields(i: Partial<DbRow>): MissingField[] { ... }
export function getMissingTrainingFields(t: Partial<DbRow>): MissingField[] { ... }
export function getMissingAssessmentFields(a: Partial<DbRow>): MissingField[] { ... }
```

Each returns `[]` when complete. Empty string, whitespace-only, `null`, and `undefined` all count as missing.

### Form wiring (same shape in all three forms)

In `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`:

1. Add state `const [missingFields, setMissingFields] = useState<MissingField[]>([])`.
2. Wrap `handleCompleteClick` (or the equivalent in Training/Assessment):
   ```ts
   const missing = getMissingInspectionFields(inspection);
   if (missing.length) {
     setMissingFields(missing);
     toast.error('Cannot complete report', {
       id: `completion-blocked-${id}`,
       description: `Required fields missing: ${missing.map(m => m.label).join(', ')}`,
       duration: Infinity,
     });
     // Scroll the first missing field into view
     document.getElementById(`field-${missing[0].key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
     return; // reject — do NOT open attestation, do NOT call completeXxx
   }
   toast.dismiss(`completion-blocked-${id}`);
   setMissingFields([]);
   // existing flow continues (attestation dialog or completeXxx)
   ```
3. Live-clear the toast and pulse as the user fixes fields:
   ```ts
   useEffect(() => {
     if (!missingFields.length) return;
     const stillMissing = getMissingInspectionFields(inspection);
     if (!stillMissing.length) {
       toast.dismiss(`completion-blocked-${id}`);
       setMissingFields([]);
     } else {
       setMissingFields(stillMissing);
     }
   }, [inspection?.organization, inspection?.location, inspection?.inspection_date]);
   ```

### Field-level pulse

Each header input that can be required gets:
- `id={`field-${key}`}` for scrolling
- a className gated on `missingFields.some(m => m.key === key)`:
  ```tsx
  className={cn(
    "...existing classes",
    isMissing && "animate-pulse ring-2 ring-destructive ring-offset-2 rounded-md",
  )}
  ```
- `aria-invalid={isMissing}` so screen readers announce it.

The pulse stops the moment the field is non-empty (Step 3 above clears `missingFields`).

### Toast behavior

- Single sonner toast per report, keyed by `completion-blocked-${reportId}` so re-clicking Complete updates the same toast instead of stacking.
- `duration: Infinity` keeps it on screen until either (a) the user fills every missing field (auto-dismiss via the effect), or (b) the user explicitly dismisses it.
- Description text lists the human labels: `"Required fields missing: Organization, Location, Inspection date"`.
- Plays well with the offline-first model: this is a pure client-side gate, no network calls, works offline.

### What stays unchanged

- `saveProgress` / autosave / IndexedDB writes — still accept empty fields.
- Existing `Report Completion Bypass` memory (non-blocking completion ignores schema validation **errors**) — still applies to the rest of the schema. We're carving out **only** the per-form `getMissing*Fields` check, which lives outside the zod parse.
- Attestation dialog flow.
- Admin re-complete flow (`inspection.attestation_signed_at` shortcut) — gets the same gate up front.
- Lock dialog after completion.
- No DB migration, no edge-function change, no schema change.

### Tests

`src/lib/__tests__/required-fields.test.ts` covering, for each report type:
- all-filled returns `[]`
- single missing field returns just that field
- whitespace-only counts as missing
- `null` / `undefined` count as missing
- field order in the returned array matches form display order (so the toast reads top-down)

### Memory update

After implementation I'll add a memory entry under `mem://features/required-field-completion-gate` and reference it from the index. It will say: completion is gated on header fields per report; gate is client-only, lives in `src/lib/required-fields.ts`, surfaces via persistent sonner toast keyed `completion-blocked-${id}` plus `animate-pulse ring-destructive` on the offending field; saves remain unblocked.
