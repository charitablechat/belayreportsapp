

## Fix: Operating Systems with No System Type Are Silently Skipped from Summary

### Root Cause

In `src/pages/InspectionForm.tsx`, line 312, the guard `if (!system.system_name) return;` causes any operating system row without a "System Type" selection (e.g., "Spotted/Low") to be completely excluded from summary generation. This means their comments are never aggregated into Repairs, Critical Actions, or Future Considerations -- even when the element has a name, a result, and comments.

In the "Test" report, the operating system "T P Shuffle" has `result = 'pass'` and a comment ("TP needed to be tightened"), but its `system_name` is empty, so it gets skipped. Similarly, "Aerial Leap" (fail), "Mountain Tops" (fail), and "Giant Swing" (pass w/provisions) are all silently dropped from the summary for the same reason.

### Fix (1 file)

**File: `src/pages/InspectionForm.tsx`**

1. **Line 312** -- Change the guard from `if (!system.system_name) return;` to `if (!system.system_name && !system.name) return;`. This ensures items are only skipped when they have neither a system type nor an element name (i.e., truly blank rows).

2. **Line 314-315** -- Adjust the entry text formatting to handle an empty `system_name` gracefully. Currently it always leads with `system_name`, producing output like "Operating System- (T P Shuffle)". Instead, lead with whichever identifier is available:
   - If `system_name` exists: `"Operating System- {system_name} ({name}): {comments}"`
   - If only `name` exists: `"Operating System- {name}: {comments}"`

### No other files need changes

- The auto-regeneration effect (lines 609-688) already correctly includes pass-with-comments systems in its change signature -- it just never fires because the generator itself skips the items.
- The edge function (`generate-inspection-html`) reads the summary text as-is from the database, so once the client writes correct data, reports will render correctly.

### Testing

After the fix, open the "Test" inspection, navigate to the Summary tab, and click "Regenerate from Inspection". The "Repairs, Alterations performed during inspection" section should now show "T P Shuffle: TP needed to be tightened." The Critical Actions section should also gain "Aerial Leap" and "Mountain Tops", and Future Considerations should gain "Giant Swing".

