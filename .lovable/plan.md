

## Fix Incomplete Report Import Extraction

### Problem

The AI extraction is likely hitting output token limits during tool-call responses, causing the model to silently truncate its output — dropping equipment items, comments, and summary data. The current code does not:
1. Set `max_tokens` on the AI request (defaults to a potentially low limit)
2. Check the `finish_reason` for `MAX_TOKENS` / `length` truncation
3. Handle the case where one call cannot fit all data

### Changes

**File: `supabase/functions/parse-inspection-docx/index.ts`**

1. **Add `max_tokens: 16384`** to the AI request body — gives the model ample room to output all items with comments verbatim

2. **Check `finish_reason`** on the AI response — if it's `"length"` or `"MAX_TOKENS"`, log a warning and set a `partial` flag in the response so the client can alert the user

3. **Strengthen the user prompt** to be more directive: explicitly list each section the AI must extract and emphasize "do NOT skip any items, include every comment verbatim, do NOT include equipment quantity"

4. **Add a second-pass retry** — if `finish_reason` indicates truncation, make a focused follow-up call asking the AI to extract only the sections that appear incomplete (equipment and summary are most commonly dropped), then merge the results

5. **Log the full `finish_reason` and usage stats** (prompt tokens, completion tokens) for debugging

**File: `src/pages/NewInspection.tsx`**

6. **Handle the new `partial` flag** — show a warning toast if the extraction was partially truncated, telling the user some items may be missing

### Technical Detail

```text
AI request changes:
  + max_tokens: 16384
  + Check: aiData.choices[0].finish_reason
  + If finish_reason === "length":
      → Second call with: "Extract ONLY equipment and summary from this report"
      → Merge into first result

User prompt change:
  "Extract ALL structured data... You MUST include:
   - Every operating system/element with its comments
   - Every piece of equipment (type, category, result, comments, production_year, rope_type — NO quantity)
   - Every zipline with all measurements and comments
   - Every standard with documentation status and comments  
   - The complete summary section (repairs, critical actions, future considerations, next inspection date)
   Do not skip ANY item. Do not summarize comments."
```

### Files

| File | Change |
|------|--------|
| `supabase/functions/parse-inspection-docx/index.ts` | Add max_tokens, check finish_reason, retry on truncation, improve user prompt |
| `src/pages/NewInspection.tsx` | Handle `partial` flag with warning toast |

