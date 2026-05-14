# Notes / comments fields lose values on navigation — same root cause

## What I found

The notes/comments fields across all three report types have the **same persistence gap** as the dropdowns: they only mutate React state and rely on the parent's 1.5-second debounced auto-save. Unlike single-line text inputs (which wire `onBlur={onImmediateSave}`), the rich-text editors and section-comment textareas are missing the blur-to-save bridge. If the user types a note and navigates within ~1.5 s, the note is dropped.

### Sites affected

1. **Inspection — Equipment notes** (`EquipmentTable.tsx`)
   - Two `<LazyRichTextEditor>` instances for `item.comments` (desktop + mobile views) — no `onBlur`.

2. **Inspection — Operating Systems notes** (`OperatingSystemsTable.tsx`)
   - Two `<VoiceRichTextEditor>` instances for `system.comments` — no `onBlur`.

3. **Inspection — Ziplines notes** (`ZiplinesTable.tsx`)
   - Two `<VoiceRichTextEditor>` instances for `zipline.comments` — no `onBlur`.

4. **Training — Summary section** (`TrainingSummarySection.tsx`)
   - Two `<VoiceRichTextEditor>` instances (`observations`, `recommendations`) — no `onBlur`. Component doesn't even accept `onImmediateSave` today; need to add the prop and thread it from `TrainingForm.tsx`.

5. **Daily Assessment — Section comments** (`SectionComments.tsx` used by `OperatingSystemsSection`, `StructureChecksSection`, `EnvironmentChecksSection`, `EquipmentChecksSection`)
   - `<DebouncedTextarea>` already flushes onBlur to its parent's `onChange`, but no `onBlur` is forwarded to trigger an immediate IDB save. The 300 ms internal debounce + 1.5 s form debounce stack to ~1.8 s of vulnerability.
   - Component doesn't accept `onImmediateSave` today; need to add and thread it from `DailyAssessmentForm.tsx` through each `<*Section>`.

(Inspection's `SummarySection.tsx` already wires `onBlur={onImmediateSave}` correctly — no change there.)

## Fix — same minimal pattern as the dropdown fix

For each editor above, pass `onBlur={onImmediateSave}` so leaving the field flushes the form's `performSave` immediately into IndexedDB. The underlying `LazyRichTextEditor`, `RichTextEditor`, and `DebouncedTextarea` already support this prop; we just need to wire it.

### Concrete changes

1. **`EquipmentTable.tsx`** — add `onBlur={onImmediateSave}` to both `<LazyRichTextEditor>` comment editors.
2. **`OperatingSystemsTable.tsx`** — add `onBlur={onImmediateSave}` to both `<VoiceRichTextEditor>` comment editors.
3. **`ZiplinesTable.tsx`** — add `onBlur={onImmediateSave}` to both `<VoiceRichTextEditor>` comment editors.
4. **`TrainingSummarySection.tsx`** — add `onImmediateSave?: () => void` to props; wire `onBlur={onImmediateSave}` on both editors.
5. **`TrainingForm.tsx`** — pass `stableTriggerImmediateSave` (or local equivalent) to `<TrainingSummarySection>`.
6. **`SectionComments.tsx`** — add `onBlur?: () => void` to props; forward to `DebouncedTextarea`.
7. **Daily Assessment section components** (`OperatingSystemsSection.tsx`, `StructureChecksSection.tsx`, `EnvironmentChecksSection.tsx`, `EquipmentChecksSection.tsx`) — add `onSectionCommentsBlur?: () => void` prop and wire to `<SectionComments>`.
8. **`DailyAssessmentForm.tsx`** — pass the existing immediate-save trigger to those sections via the new prop.

### Why this is safe

- We are **adding** a save trigger, not changing what or how data is saved.
- It runs through the same `performSave` pipeline as text-input blur. No backend, RLS, schema, secrets, or sync behavior changes.
- Rich-text editors fire `onBlur` only when the user truly leaves the field (LazyRichTextEditor uses click-outside detection), so we won't double-fire while typing.
- This complements — not replaces — the existing 1.5 s debounce.

## Verification

- Type a note in each affected location, immediately navigate away, return — value persists.
- Repeat offline (DevTools Network → Offline) to confirm IDB persistence.
- Confirm no regression: the existing `useUnsavedChanges` "save on leave" dialog should appear less often (changes commit sooner).
- Console should remain clean of new save-in-flight warnings.

## Out of scope

- No changes to dropdowns (already shipped in the previous turn).
- No changes to debounce timings, save mutex, Realtime reconciliation, or visual styling.
