

## Add .doc, Google Docs, and Markdown Support to Report Import

### Overview
Extend the existing report import feature to accept `.doc` (legacy Word), Google Docs (exported as `.docx`), and Markdown (`.md`) files, in addition to the current `.docx` and `.pdf` support.

### Approach

**Google Docs note:** Google Docs doesn't have a native file format that can be uploaded directly. Users export Google Docs as `.docx` — which is already supported. The solution is to make this clear in the UI text rather than add a separate parser.

**Legacy `.doc` note:** `.doc` is a binary format (OLE2) that's extremely difficult to parse without a full library. The practical approach is to attempt basic text extraction from the binary stream similar to the PDF fallback approach.

### Changes

**1. Edge Function: `supabase/functions/parse-inspection-docx/index.ts`**
- Add a `extractTextFromDoc()` function for legacy `.doc` files — scans for Unicode/ASCII text sequences in the binary OLE2 stream (similar to the PDF fallback)
- Add a `extractTextFromMarkdown()` function — strips Markdown syntax (headers, bold, links, etc.) and returns clean text
- Update the file type routing to accept `doc` and `md` extensions alongside `docx` and `pdf`
- Update error message to list all supported types

**2. Frontend: `src/pages/NewInspection.tsx`**
- Update `accept` attribute on file input: `.docx,.doc,.pdf,.md`
- Update file extension validation to allow `doc` and `md`
- Update UI help text to: "Drop a .docx, .doc, .pdf, or .md file here (also works with Google Docs exported as .docx)"

### Files

| File | Change |
|------|--------|
| `supabase/functions/parse-inspection-docx/index.ts` | Add `.doc` and `.md` text extractors, update routing |
| `src/pages/NewInspection.tsx` | Update accepted file types, validation, and help text |

