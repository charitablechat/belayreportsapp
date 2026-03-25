## Import Previous Report from Word Document

### Overview

Add a "Clone from Previous Report" feature to the New Inspection page. The user uploads a `.docx or pdf` file of a previous inspection report, an AI-powered edge function extracts structured data from it, and a new inspection is created with all systems, equipment, ziplines, and standards pre-filled.

### How It Works

1. On the New Inspection page, a new "Import from Previous Report" button/section appears
2. User selects a `.docx` file
3. The file is uploaded to a backend function that uses AI to parse the document and extract structured fields
4. The extracted data auto-populates the form (organization, location, onsite contact, etc.)
5. On submit, the new inspection is created with all child rows (systems, equipment, ziplines, standards) pre-inserted

### Technical Details

**New Edge Function: `parse-inspection-docx**`

- Accepts a `.docx` file upload
- Converts document content to text using Deno-compatible parsing
- Sends the extracted text to Lovable AI (Gemini) with a structured JSON schema to extract:
  - `organization`, `location`, `onsite_contact`, `previous_inspector`, `course_history`
  - `systems[]` — name, result, comments
  - `equipment[]` — equipment_type, equipment_category, result, comments, quantity, production_year, rope_type
  - `ziplines[]` — zipline_name, cable_type, cable_length, braking_system, ead_system, result, comments
  - `standards[]` — standard_name, has_documentation, comments
  - `summary` — repairs_performed, critical_actions, future_considerations, next_inspection_date
- Returns structured JSON to the client

**Modified: `src/pages/NewInspection.tsx**`

- Add a file input with drag-and-drop support for `.docx` files
- On file selection, call the edge function and show a loading state
- Populate `formData` fields from the response
- Store extracted child data (systems, equipment, ziplines, standards, summary) in component state
- On form submit, after creating the inspection, bulk-insert all child rows into their respective tables

**Files to create/modify:**


| File                                                | Change                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `supabase/functions/parse-inspection-docx/index.ts` | New edge function — parses .docx, calls AI for structured extraction        |
| `src/pages/NewInspection.tsx`                       | Add file upload UI, call edge function, store & submit extracted child data |


### User Experience

- The upload section shows below the form title with a dashed border drop zone
- While parsing, a spinner with "Analyzing report..." is shown
- Once parsed, all form fields auto-fill and a success toast confirms how many systems/equipment/ziplines were found
- The user can review and edit any pre-filled data before submitting
- Results default to "Not Inspected" for the new report (previous results are informational only)