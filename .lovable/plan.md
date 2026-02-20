
## Align "New Training Report" Form to Match "New Daily Assessment" Layout

### What Changes

The New Training form is restructured to match the Daily Assessment form exactly, both in field order and in how the location/GPS works.

### Field Order (after change)
1. Organization * (unchanged)
2. Site / Location — text input + "Get Location" button inline (same row), GPS auto-fills the text field with address, coordinates shown below with info note
3. Trainer of Record (plain text display, moved below location)
4. Buttons: "Create Training" / "Create Locally" + Cancel

### Specific Changes to `src/pages/NewTraining.tsx`

**State rename**: `location` → `site` in `formData` to match Daily Assessment's naming convention and make GPS auto-fill the text field (currently GPS only saves coordinates but doesn't fill in the text box).

**`handleLocationCapture`**: When GPS succeeds, also set `site: position.address` — exactly as Daily Assessment does — so the text field auto-populates with the resolved address name.

**Remove the separate "GPS Coordinates (Optional)" section**: Merge the "Get Location" button inline with the text input, side-by-side like Daily Assessment.

**Remove the separate GPS coordinates display below the button**: Move it below the inline row, same as Daily Assessment.

**Reorder fields**: Move "Trainer of Record" below the combined Site/Location row.

**Remove the `X` clear button for GPS**: Daily Assessment keeps it but only when coordinates exist — keep same behavior.

**Remove GPS-only label ("GPS Coordinates (Optional)")**: The combined row's label becomes "Site / Location" (matching Daily Assessment). Mark it required (*) to match Daily Assessment, or keep it optional — since trainings only require organization, keep it optional (no asterisk) to preserve existing validation logic.

**Database column**: The `trainings` table column is called `location` (not `site`) — the state variable rename is internal only; the submit handler continues to write `formData.site` → `location` column.

### No other files change
- `TrainingHeader.tsx` is unaffected (it already has an independent location input for editing inside the report)
- No database migrations needed
- No backend changes needed
