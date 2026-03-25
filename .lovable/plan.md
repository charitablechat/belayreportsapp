## Import Previous Report from Word Document

### Overview

Add a "Clone from Previous Report" feature to the New Inspection page. The user uploads a `.docx`, `.doc`, `.pdf`, or `.md` file of a previous inspection report, an AI-powered edge function extracts structured data from it, and a new inspection is created with all systems, equipment, ziplines, and standards pre-filled.

### Supported File Types

- `.docx` — Modern Word documents (also works with Google Docs exported as .docx)
- `.doc` — Legacy Word documents (basic text extraction from OLE2 binary)
- `.pdf` — PDF files (text extraction from BT/ET blocks)
- `.md` / `.markdown` — Markdown files (syntax stripped, clean text sent to AI)

### How It Works

1. On the New Inspection page, a new "Import from Previous Report" button/section appears
2. User selects a supported file
3. The file is uploaded to a backend function that uses AI to parse the document and extract structured fields
4. The extracted data auto-populates the form (organization, location, onsite contact, etc.)
5. On submit, the new inspection is created with all child rows (systems, equipment, ziplines, standards) pre-inserted

### User Experience

- The upload section shows below the form title with a dashed border drop zone
- While parsing, a spinner with "Analyzing report..." is shown
- Once parsed, all form fields auto-fill and a success toast confirms how many systems/equipment/ziplines were found
- The user can review and edit any pre-filled data before submitting
- Results default to "Not Inspected" for the new report (previous results are informational only)