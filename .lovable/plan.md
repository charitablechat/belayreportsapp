

## Add Text Location Field to New Training Report

### What Changes
The "New Training Report" form currently only supports GPS coordinate capture for location. This plan adds a text input field so users can type a location (e.g., "Camp Thunderbird, Lake Wylie, SC") in addition to (or instead of) capturing GPS coordinates.

### Database Change
Add a `location` text column to the `trainings` table (nullable, defaults to empty string), matching how inspections already store location text.

### UI Changes

**File: `src/pages/NewTraining.tsx`**
- Add a `location` field to the `formData` state (empty string default)
- Add a text input field labeled "Location" above the GPS capture button
- The text input and GPS capture button sit together in the same section so the user can do either or both

**File: `src/components/training/TrainingHeader.tsx`**
- Add a "Location" text input field so users can also view/edit the location text from within the training form itself
- Wire it to `onUpdate('location', value)`

**File: `src/pages/NewTraining.tsx` (submit handler)**
- Include `location` in the insert payload sent to the database

### Technical Details

1. **Migration SQL:**
   ```sql
   ALTER TABLE trainings ADD COLUMN location text NOT NULL DEFAULT '';
   ```

2. **NewTraining.tsx state** adds `location: ""` to formData and includes it in the insert call.

3. **TrainingHeader.tsx** adds a text input between the organization field and the date pickers, labeled "Location", using `VoiceNameInput` for voice support consistency.

4. **Offline storage** -- the `saveTrainingOffline` call already passes the full object, so including `location` requires no additional offline logic changes.

5. No RLS policy changes needed -- existing policies on the `trainings` table already cover all CRUD operations.
