

## Fix Report Import: Replace Broken Text Extraction

### Problem

The edge function logs reveal the actual root cause is **not** the AI model — it's the text extraction:

- `.doc` files: The custom UTF-16LE scanner extracted only **585 chars** from a real report, resulting in 0 systems and 0 equipment
- `.pdf` files: The naive BT/ET text operator parser produces garbled output for compressed PDFs (which is most PDFs)
- `.docx` files: The custom ZIP parser works but misses some XML entries when the ZIP uses data descriptors

The AI itself works correctly when given proper text — the same report as PDF (with 10K chars extracted) returned 6 systems, 9 equipment, 2 ziplines.

### Solution: Use `pdf-parse` and `mammoth` Libraries

Replace all three custom text extractors with battle-tested npm libraries available in Deno edge functions:

### Changes

**File: `supabase/functions/parse-inspection-docx/index.ts`**

1. **Replace `.docx` extraction** — use `npm:mammoth@1.8.0` which properly handles all OOXML edge cases (merged cells, nested tables, styles) and returns clean text
2. **Replace `.pdf` extraction** — use `npm:pdf-parse@1.1.1` which handles FlateDecode, CIDFont, and all standard PDF encodings
3. **Replace `.doc` extraction** — use `npm:word-extractor@1.0.4` which properly reads OLE2 compound binary format instead of scanning for UTF-16LE byte sequences
4. **Remove all custom parsers** — delete `extractTextFromDocx`, `parseZipEntries`, `extractTextFromXml`, `extractTextFromDoc`, `extractTextFromPdf` (approximately 230 lines of fragile custom code)
5. **Preserve original result values** — change `result: "Not Inspected"` default to use the AI-extracted result value when available, falling back to "Not Inspected" only when null

**File: `src/pages/NewInspection.tsx`**

6. **Preserve original results from import** — update the `insertChildData` function to use the AI-extracted `result` values instead of always overriding with "Not Inspected"

### Technical Detail

```text
Text extraction replacement:
  .docx: custom ZIP parser (broken on data descriptors)
      → mammoth.extractRawText(buffer)
  .pdf:  custom BT/ET regex (fails on compressed streams)  
      → pdfParse(buffer).then(d => d.text)
  .doc:  custom UTF-16LE scan (captures ~5% of content)
      → WordExtractor().extract(buffer).then(d => d.getBody())

Result preservation:
  Before: result: "Not Inspected"  (always)
  After:  result: extractedResult || "Not Inspected"
```

### Files

| File | Change |
|------|--------|
| `supabase/functions/parse-inspection-docx/index.ts` | Replace 3 custom text extractors with npm libraries, remove ~230 lines of broken code |
| `src/pages/NewInspection.tsx` | Use extracted result values instead of always "Not Inspected" |

