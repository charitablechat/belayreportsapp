# Two-Stage Report State: Draft vs Complete

Most of this system already landed in the prior turn (shared helper, Inspection + Training wiring, tests). This plan finishes the remaining slice and locks in the aesthetic polish you asked for.

## What's already in place

- `src/lib/required-fields.ts` — `getMissingInspectionFields`, `getMissingTrainingFields`, `getMissingDailyAssessmentFields`. Empty string, whitespace, null, undefined all count as missing.
- Inspection form: completion gate, persistent sonner toast (`duration: Infinity`, key `completion-blocked-${id}`), scroll-to-first-missing, live-clear effect, header inputs get `id="field-${key}"` + `aria-invalid` + pulse class when invalid.
- Training form: same wiring.
- Saves/autosave/IndexedDB writes remain unblocked. Existing Report Completion Bypass for non-header schema errors is unchanged. Attestation / lock dialog / admin re-complete unchanged.
- Tests: `src/lib/__tests__/required-fields.test.ts` (12 passing).

## What this plan adds

### 1. Daily Assessment wiring (parity with the other two)
- `src/components/daily-assessment/DailyAssessmentForm.tsx`: add `missingFields` state, wrap `handleCompleteClick` with `getMissingDailyAssessmentFields`, persistent toast keyed `completion-blocked-${id}`, scroll first missing field into view, `useEffect` that live-clears toast + state when fields fill in.
- `src/components/daily-assessment/DailyAssessmentHeader.tsx`: pass `missingFields` down, add `id="field-organization"` / `id="field-assessment_date"`, conditional pulse class + `aria-invalid`.

### 2. Subtle, developer-focused pulse
Replace the current `animate-pulse ring-destructive` (whole-element opacity pulse — too loud) with a dedicated keyframe in `tailwind.config.ts` that animates `box-shadow` only:

```text
@keyframes pulse-error {
  0%, 100% { box-shadow: 0 0 0 0 hsl(var(--destructive) / 0.0); border-color: hsl(var(--destructive)); }
  50%      { box-shadow: 0 0 0 4px hsl(var(--destructive) / 0.25); border-color: hsl(var(--destructive)); }
}
```
- Animation utility: `animate-pulse-error` running 1.6s ease-in-out infinite.
- Respects `prefers-reduced-motion` via a `@media` block that flips to a static 1px destructive border + ring, no motion.
- Applied as a single class `field-invalid` (defined in `index.css` `@layer components`) so all three forms share one source of truth.

### 3. Toast accessibility/contrast
- Continue using sonner (already global). Pass `style={{ background: 'hsl(var(--destructive))', color: 'hsl(var(--destructive-foreground))' }}` and `className: 'border border-destructive-foreground/20'` on the blocking toast for high contrast.
- Add `role: 'alert'` via sonner's `important: true` so screen readers announce immediately.
- Body lists missing fields as a comma-separated, human-readable list ("Organization, Assessment date").

### 4. Tests
- Extend `src/lib/__tests__/required-fields.test.ts` if any Daily Assessment edge case is uncovered (whitespace org, null assessment_date).
- New `src/components/daily-assessment/__tests__/daily-assessment-completion-gate.test.tsx`: renders form with empty header, clicks Complete, asserts (a) `onComplete` not called, (b) toast text contains both field names, (c) `field-organization` has `aria-invalid="true"` and `field-invalid` class.

### 5. Memory
Add `mem://features/required-field-completion-gate` documenting: client-only gate via `src/lib/required-fields.ts`, persistent sonner toast (`duration: Infinity`, key `completion-blocked-${id}`), shared `field-invalid` class with reduced-motion fallback, saves/autosave never blocked.

## Files touched

- `src/components/daily-assessment/DailyAssessmentForm.tsx` (edit)
- `src/components/daily-assessment/DailyAssessmentHeader.tsx` (edit)
- `tailwind.config.ts` (add `pulse-error` keyframe + animation)
- `src/index.css` (add `.field-invalid` component class + reduced-motion fallback)
- `src/components/inspection/InspectionHeader.tsx`, `src/components/training/TrainingHeader.tsx` (swap `animate-pulse ring-destructive` → `field-invalid`)
- Toast call sites in all three forms (add high-contrast style + `important: true`)
- `src/components/daily-assessment/__tests__/daily-assessment-completion-gate.test.tsx` (new)
- `mem://features/required-field-completion-gate` (new)

## Out of scope

- Row-level result/checkbox validation (you chose Header fields only).
- Any change to save/autosave/IDB behavior.
- Backend / RLS / schema changes.
