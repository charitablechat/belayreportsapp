

## Remove Microphone Button from "Report Modified By" Field

### What's Changing

The "Report modified by" field is a read-only, auto-populated field that should never accept voice input. Two of the three form headers currently render it with a microphone button via `VoiceInput` or `VoiceNameInput`. This plan replaces those with a plain `Input` component (which the DailyAssessmentHeader already uses correctly).

### Regarding the Population Logic

The `last_modified_by` value is **only written during an explicit save action** when the current user differs from the report owner. Simply opening a report as an admin does NOT set this field. If the field is showing a name, it means a previous edit-and-save occurred. This behavior is correct and requires no changes.

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/InspectionHeader.tsx` | Replace `VoiceInput` with plain `Input` for the "Report modified by" field (line 94) |
| `src/components/training/TrainingHeader.tsx` | Replace `VoiceNameInput` with plain `Input` for the "Report modified by" field (line 142) |

### Technical Details

**InspectionHeader.tsx (line 91-99)**
- Current: `<VoiceInput value={modifiedByName} disabled className="..." />`
- Updated: `<Input value={modifiedByName} disabled className="..." />`
- The `VoiceInput` import can be kept since it's used elsewhere in the component

**TrainingHeader.tsx (line 140-145)**
- Current: `<VoiceNameInput value={modifiedByName} disabled className="..." />`
- Updated: `<Input value={modifiedByName} disabled className="..." />`
- The `Input` component is already imported in this file

**DailyAssessmentHeader.tsx** -- No change needed; already uses plain `Input`

