

User wants: pressing **Enter** in any input/textarea on any report form should blur the field (exit the box) but **not** scroll, jump, or move focus elsewhere — the page stays exactly where it is.

## Current behavior (inferred)
- Inputs/textareas: Enter in `<input>` would submit a form if one wraps it; in `<textarea>` it inserts a newline.
- TipTap rich text editors: per memory `report-form-navigation-ux`, Tab navigates between fields — Enter behavior unspecified, likely inserts newline (which is correct for rich text and should be preserved).
- No global Enter-to-blur handler exists.

## Approach

Add a single global handler that, on `keydown` of `Enter` (without Shift) targeting an `<input>` or `<textarea>`:
1. `e.preventDefault()` — stop form submit / newline insert
2. Capture `window.scrollY` + element `getBoundingClientRect()` before blur
3. Call `target.blur()`
4. After blur, restore scroll position if the browser shifted it (mobile keyboard dismissal can cause jumps)

**Scope**: only the three report form routes — `/inspection/:id`, `/training/:id`, `/daily-assessment/:id` (and their `new-*` variants). Don't apply globally because:
- Search bars, autocomplete, dialogs may rely on Enter to submit/select
- Dashboard filters use Enter intentionally

**Exclusions inside the report forms**:
- TipTap rich text editors (`[contenteditable="true"]`) — Enter must insert newline/paragraph
- `<textarea>` elements where multi-line entry is the point — for these, Enter should still insert newline; only **Ctrl/Cmd+Enter** blurs. (Or alternatively: plain Enter blurs textareas too — depends on user intent.)
- Autocomplete components (`GlobalAutocomplete`, `DatabaseAutocomplete`, `OrganizationAutocomplete`, `EquipmentTypeCombobox`) — Enter selects highlighted suggestion; must not be intercepted while their dropdown is open
- Select / Combobox triggers — Enter opens them
- Buttons — Enter activates them

## One question before I build

For **textareas** (multi-line fields like comments, observations), should plain **Enter** blur the field, or should it still insert a newline (with **Ctrl/Cmd+Enter** to blur)?

- **Option A (recommended)**: Plain Enter blurs `<input>` only; textareas keep newline behavior, Cmd/Ctrl+Enter blurs them. Matches industry convention (Slack, GitHub, etc.).
- **Option B**: Plain Enter blurs everything, even textareas. Simpler but breaks multi-line note entry — users can't add line breaks in observations/recommendations without using the rich-text editor.

## Implementation (after you pick A or B)

**New file**: `src/hooks/useEnterToBlur.tsx`
- Attaches a `keydown` listener (capture phase) scoped to a container ref
- Filters out: contenteditable, autocomplete-open state (check `aria-expanded="true"` on ancestor), buttons, selects
- On valid Enter: prevent default, snapshot scroll, blur, restore scroll on next frame

**Wire into**:
- `src/pages/InspectionForm.tsx`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`
- `src/pages/NewInspection.tsx`, `NewTraining.tsx`, `NewDailyAssessment.tsx`

Each gets a ref on its root form container; hook is called with that ref.

**No DB / no edge-function changes.**

## Files touched
- NEW: `src/hooks/useEnterToBlur.tsx`
- EDIT: 6 form pages above (one ref + one hook call each)

Reply **A** or **B** (or describe different behavior) and I'll build it.

