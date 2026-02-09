
# Inconsistencies Found in the Inspection Report

After a thorough review acting as a typical user, here are the issues discovered:

---

## 1. OrganizationAutocomplete Still Uses PopoverTrigger (Toggle Bug)

**File:** `src/components/OrganizationAutocomplete.tsx` (line 259)

The "Facility Name" field uses `PopoverTrigger` instead of `PopoverAnchor`. This is the exact same bug that was just fixed in `GlobalAutocomplete` -- clicking the input opens then immediately closes the dropdown due to the Radix toggle conflict.

**Fix:** Replace `PopoverTrigger` with `PopoverAnchor` (same pattern as the GlobalAutocomplete fix).

---

## 2. OrganizationAutocomplete: Enter Key Doesn't Show Committed Value

**File:** `src/components/OrganizationAutocomplete.tsx` (line 179-184)

The `handleSelect` function does not reset `isEditing` to `false`. This is the same bug just fixed in `GlobalAutocomplete` -- after pressing Enter, the input shows the cleared `search` value instead of the committed `value` prop.

**Fix:** Add `setIsEditing(false)` to `handleSelect`.

---

## 3. OperatingSystemsTable Uses Index-Based Updates (Data Loss Risk)

**File:** `src/components/inspection/OperatingSystemsTable.tsx` (line 65-69)

`updateSystem` creates a shallow copy with spread and updates by array index. Meanwhile, `EquipmentTable` uses functional updates with ID-based matching (`onUpdate(prev => prev.map(eq => eq.id === item.id ? ...))`). The index-based approach can cause data loss when background auto-saves reorder or modify the array between when the user started editing and when the update applies.

**Fix:** Change `updateSystem` to use functional updates with ID-based matching, consistent with `EquipmentTable`.

---

## 4. ZiplinesTable Also Uses Index-Based Updates (Same Risk)

**File:** `src/components/inspection/ZiplinesTable.tsx` (line 75-79)

Same issue as OperatingSystemsTable -- `updateZipline` uses index-based array mutation instead of functional ID-based updates.

**Fix:** Change to functional updates with ID-based matching.

---

## 5. OperatingSystemsTable and ZiplinesTable Are Not Wrapped in React.memo

**Files:** `OperatingSystemsTable.tsx`, `ZiplinesTable.tsx`

`EquipmentTable` is wrapped in `React.memo` for performance. OperatingSystems and Ziplines tables are not, meaning they re-render on every parent state change (e.g., when equipment data changes on a different tab).

**Fix:** Add `export default memo(OperatingSystemsTable)` and `export default memo(ZiplinesTable)`.

---

## 6. StandardsTable Has No onImmediateSave Prop

**File:** `src/components/inspection/StandardsTable.tsx`

When a user checks/unchecks a standards checkbox, there is no immediate save triggered. All other tables (Equipment, Systems, Ziplines, Summary) trigger `onImmediateSave` on user interactions. Standards only save via the 1.5-second debounce timer, which could lose data if the user navigates away quickly.

**Fix:** Add `onImmediateSave` prop to StandardsTable and call it after checkbox changes.

---

## 7. EquipmentTable Comments Use LazyRichTextEditor; Systems Use VoiceRichTextEditor

**Files:** `EquipmentTable.tsx` (line 214), `OperatingSystemsTable.tsx` (line 135)

Equipment comments use `LazyRichTextEditor` (no voice input), while Operating Systems comments use `VoiceRichTextEditor` (with microphone button). This is inconsistent from a user perspective -- voice input is available in one section but not another.

**Fix:** Standardize to `VoiceRichTextEditor` across all comment fields, or use `LazyRichTextEditor` everywhere for consistency.

---

## 8. Ziplines Comments Use Plain RichTextEditor (No Voice, No Lazy Loading)

**File:** `ZiplinesTable.tsx` (line 248-253)

Ziplines comments use the basic `RichTextEditor` -- no voice input AND no lazy loading. This is a third variant, different from both Equipment (LazyRichTextEditor) and Operating Systems (VoiceRichTextEditor).

**Fix:** Standardize to match the chosen pattern from item 7.

---

## Technical Summary

| # | Component | Issue | Severity |
|---|-----------|-------|----------|
| 1 | OrganizationAutocomplete | PopoverTrigger toggle bug | High - field unusable |
| 2 | OrganizationAutocomplete | Enter key doesn't show value | Medium - confusing UX |
| 3 | OperatingSystemsTable | Index-based updates | Medium - data loss risk |
| 4 | ZiplinesTable | Index-based updates | Medium - data loss risk |
| 5 | OperatingSystems/Ziplines | Missing React.memo | Low - performance |
| 6 | StandardsTable | No immediate save | Medium - data loss risk |
| 7 | EquipmentTable | No voice on comments | Low - inconsistent UX |
| 8 | ZiplinesTable | No voice or lazy on comments | Low - inconsistent UX + perf |

All fixes follow existing patterns already established in the codebase (the EquipmentTable/GlobalAutocomplete patterns are the "gold standard" to replicate).
