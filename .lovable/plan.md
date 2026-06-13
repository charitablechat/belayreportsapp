## Root cause

The import pipeline (`supabase/functions/parse-inspection-docx/index.ts`) silently drops items in three places. Any one of them can cause the symptom; long reports usually hit all three.

1. **Hard 60,000-character text truncation before the AI ever sees it.**
   `index.ts:97-101` slices the extracted document text at 60k chars and appends `"[...truncated...]"`. Real inspection reports routinely run 80-150k characters of plain text (tables of equipment expand a lot once mammoth flattens them). Everything past 60k — usually the back half of the equipment inventory and the standards/summary section — is invisible to the AI. No item from that range can ever come back.

2. **Single AI call capped at 16,384 completion tokens.**
   `index.ts:246` + the `tool_choice` forced function call. A fully populated tool-call JSON for ~150 equipment rows + ~40 elements + verbatim comments easily exceeds that. When Gemini hits `finish_reason: "length"`, the tool-call arguments come back as a partial JSON string. `JSON.parse` either throws (caught above as "AI did not return structured data") or, more commonly, succeeds on a structurally-valid prefix that lost its final array entries.

3. **Two-pass "merge" keeps the longer array instead of unioning them.**
   `index.ts:308-316`. When the first pass is truncated, a second pass runs with the *same* truncated text and the same forced tool. The merge step picks `secondExtracted[section]` only if it has more items — so items that appeared only in pass 1 are discarded, and items only in pass 2 replace (not augment) pass 1. Net result is "best of two partial lists," never their union.

Supporting evidence: the function already logs `Extracted: X systems … Y equipment …`, and the truncation flag is returned to the client (`NewInspection.tsx:325` shows the "Import may be incomplete" toast). The toast is firing for users on real reports — that is the same condition as the silent drops here.

The frontend (`NewInspection.tsx` + `src/lib/import-normalize.ts`) and the database write path are not at fault: whatever the edge function returns is normalized and pre-filled correctly. So the fix lives entirely in the edge function.

## Plan

Single, focused edit to `supabase/functions/parse-inspection-docx/index.ts`. No schema changes, no frontend changes, no new dependencies.

### Step 1 — Remove the 60k character hard cap; chunk instead

- Delete the `maxChars = 60000` slice.
- If `extractedText.length` is above a configurable threshold (default 50,000 chars), split the text into overlapping chunks (e.g. 45,000 chars with a 2,000-char overlap so a row that straddles a boundary is seen by both chunks).
- Each chunk is sent through the same AI tool-call extraction with the same schema and system prompt.
- Short reports (under the threshold) still go through a single AI call — no behavior change for the common case.

### Step 2 — Raise the per-call output budget and tighten the prompt

- Bump `max_tokens` from 16,384 to the model's max (32,768 for `google/gemini-2.5-pro`) so a single chunk almost never hits `finish_reason: "length"`.
- Keep `tool_choice` forced; the per-chunk payload is now small enough to fit.

### Step 3 — Replace "longer array wins" with a true union + dedupe

For each section (`systems`, `equipment`, `ziplines`, `standards`), accumulate items from every chunk and every retry pass, then dedupe with a stable key:

| Section | Dedupe key |
|---|---|
| systems | `name` + `system_name` (case- and whitespace-normalized) |
| equipment | `equipment_type` + `equipment_category` + `production_year` + `rope_type` |
| ziplines | `zipline_name` |
| standards | `standard_name` |

When duplicates collide, prefer the row with the longer non-empty `comments` so verbatim notes are not lost.

For scalar header fields (`organization`, `location`, dates, `summary.*`) keep the existing behavior: first non-empty value wins, except `summary.*` which keeps the longest text per sub-field (already implemented for the whole `summary`; extend to per-field).

### Step 4 — Update the truncation flag semantics

- `truncated` (in the response) currently means "we cut the input." With chunking, that becomes false. Replace it with `incomplete: boolean` that is true only if *any* chunk's second-pass retry still came back with `finish_reason: "length"`. The frontend's existing `toast.warning("Import may be incomplete", …)` branch keeps working — only the field name changes.
- Adjust the one client read site (`NewInspection.tsx:325` area) to read `incomplete ?? truncated` so old deploys stay compatible during the rollout window.

### Step 5 — Logging for verification

Per chunk: log chunk index, char range, finish reason, counts per section. At the end: log final union counts and dedupe drop counts. These already exist for the single-pass case; extend the same log lines across chunks so the next "items missing" report is diagnosable from the function logs alone.

## Verification (before declaring done)

1. **Unit-level**: add focused tests for the new merge/dedupe helpers in `supabase/functions/parse-inspection-docx/` (pure functions, no Deno serve), covering: union across two chunks, comment-length tiebreak, zipline-vs-system classification preserved, empty arrays.
2. **Edge function smoke**: invoke locally / via `supabase--curl_edge_functions` with three real fixtures:
   - small `.docx` (under threshold, single pass) — counts must match the current production output exactly.
   - large `.docx` (over 100k chars) — counts must be ≥ current output and match a manual row count from the source document.
   - `.pdf` re-export of the same large report — counts must match the `.docx` run within ±1 row.
3. **Frontend round-trip**: in the preview, run "Import from Previous Report" with the large fixture, confirm the toast no longer says "may be incomplete," and visually verify every section's row count against the source. Spot-check 5 comments verbatim.
4. **Regression**: existing `src/lib/__tests__/import-normalize.test.ts` must still pass unchanged.

## What will NOT change

- No database schema changes, no migrations, no RLS changes.
- No change to `src/lib/import-normalize.ts`, the `NewInspection.tsx` pre-fill code path, or the IndexedDB write path.
- No new dependencies (`mammoth`, `pdf-parse`, `word-extractor` stay on current versions).
- No change to the AI model, gateway URL, or auth pattern.
- No touching of unrelated edge functions or the other two import paths (training, daily assessment) in this change.

## Risk assessment

- The chunking path runs only above 50k chars. Small reports take the existing one-call path verbatim, so they cannot regress.
- Doubling/tripling AI calls on large reports increases credits-per-import and latency by roughly the chunk count. Mitigation: 50k threshold is tunable; we can lift it after observing real chunk sizes. Will note this trade-off in the closing summary.
- The dedupe keys above are conservative (won't merge two genuinely-different rows that share the same name). If a report legitimately has two distinct equipment lines with identical type+category+year+rope, the second will be kept as a separate row only when comments differ — which is the common real-world case anyway.

Ready to implement on approval.