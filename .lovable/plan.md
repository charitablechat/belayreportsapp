## Why users see "File too large"

In `src/pages/NewInspection.tsx` (line 205) the import handler hard-rejects any file over **20 MB**:

```ts
if (file.size > 20 * 1024 * 1024) {
  toast.error("File too large", { description: "Maximum file size is 20 MB." });
  return;
}
```

The whole file is then POSTed as `multipart/form-data` to the `parse-inspection-docx` edge function, which calls `file.arrayBuffer()` and runs `mammoth` / `pdf-parse` / `word-extractor` server-side.

Two real problems drive the limit:

1. **Edge function payload ceiling.** Supabase Edge Runtime caps inbound request bodies well below the size of an inspection PDF that has embedded site photos (often 25–80 MB). Raising the client limit alone would just move the failure to a 413 / network abort.
2. **Edge function memory.** `pdf-parse` and `mammoth` materialize the entire document plus extracted images in RAM. A 60 MB photo-heavy PDF reliably OOMs the function even when it does upload.

The parser itself only ever uses the **plain text** of the document — see line 89 of `supabase/functions/parse-inspection-docx/index.ts`, where the extracted text is immediately truncated to 60 000 characters before being sent to the model. Embedded images are decoded, held in memory, and then discarded.

## Fix: extract text in the browser, send text-only to the edge function

The image bytes never need to cross the network. We move text extraction to the client, then send a small JSON body (`{ fileName, text }`) to the edge function. This makes the import effectively size-unbounded for the user — a 200 MB PDF with 400 photos becomes a ~200 KB text upload.

### 1. New client-side text extractor

Add `src/lib/import-text-extractor.ts`:

- `extractDocxText(file)` — `mammoth.browser` `extractRawText({ arrayBuffer })`.
- `extractPdfText(file)` — `pdfjs-dist` (already viable in browser); iterate pages, concat `getTextContent().items[].str`.
- `extractDocText(file)` — legacy `.doc` is rare and `word-extractor` is Node-only; keep it as a server-side fallback (see step 3) and warn the user it still needs network + ≤20 MB.
- `extractMarkdownText(file)` — `await file.text()` + the same regex strip already in the edge function.

Add `mammoth` and `pdfjs-dist` to `dependencies`. Both ship browser builds; bundle impact is acceptable (lazy-import them inside the extractor so the dashboard isn't penalized).

### 2. Update `handleFileImport` in `NewInspection.tsx`

- Remove the 20 MB hard check. Replace with a soft warning at, say, 200 MB just to catch obvious mistakes (with a "continue anyway" toast, not a block).
- Run the appropriate extractor in a try/catch.
- Show progress: `setImportLoading(true)` already exists; add a status line like "Reading document…" while extraction runs (PDF text extraction on a 100 MB file takes a few seconds on iPad).
- POST `{ fileName, text }` as `application/json` to `parse-inspection-docx` instead of multipart.
- Keep the existing 120 s abort, success/partial/truncated handling, and toast logic.

### 3. Update the edge function `parse-inspection-docx/index.ts`

Accept either shape:

- **Existing path** (multipart) — keep for `.doc` legacy fallback and any older clients still in flight; leave the size as-is. Tag the log line so we can deprecate later.
- **New path** (`application/json` with `{ fileName, text }`) — skip mammoth/pdf-parse entirely, jump straight to the existing `maxChars = 60_000` truncation and AI extraction. This is the fast, memory-safe path.

No schema or RLS changes. `verify_jwt` stays `true`.

### 4. UX copy

- Drop the "Maximum file size is 20 MB" line from the dropzone helper text in `NewInspection.tsx` (around line 596–636) — replace with "PDF, DOCX, DOC, or Markdown. Photos in the file are ignored — only the text is read."
- Keep the offline guard (`!navigator.onLine`) — text extraction is local but the AI call still needs network.

## Verification

1. Import a 45 MB photo-heavy PDF on an iPad → no "too large" toast, extraction completes, fields populate.
2. Import a 200 MB PDF → completes (slow but works); confirm only JSON text crosses the wire in DevTools network panel.
3. Import a malformed PDF → extractor throws, friendly "Could not read document" toast, no crash.
4. Import a `.doc` legacy file → falls back to the multipart path, behaves exactly as today.
5. Existing `.docx` and `.md` imports still work and still respect the 60 000-char model truncation (server-side `truncated` / `partial` warnings continue to fire on huge text bodies).

## Out of scope

- Streaming/chunked AI extraction for documents whose **text** exceeds 60 000 chars. That's a separate, larger change (multi-pass with overlap), and the existing "partial / truncated" warnings already inform users.
- Removing the legacy `.doc` server path. Keeping it avoids breaking the small minority of users still uploading old Word files.
- Any change to photo upload pipelines, sync, RLS, or schema.
