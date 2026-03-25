

## Fix Incomplete Report Import Extraction

### Problem

The AI extraction (Gemini 2.5 Flash) is not reliably capturing all elements, equipment, comments, and summary data from uploaded reports. Flash trades accuracy for speed — now that timeout safeguards (90s backend, 120s client) are in place, we can use a stronger model without risk of hanging.

### Root Causes

1. **Model accuracy**: `gemini-2.5-flash` is weaker at exhaustive structured extraction from long documents compared to `gemini-2.5-pro`. It skips items, abbreviates comments, and sometimes drops entire sections.
2. **No extraction verification**: The system has no way to detect when the AI silently drops items (as opposed to hitting token limits, which is already handled).
3. **Summary merge logic is too conservative**: The second-pass merge only replaces summary if the first pass had *both* `repairs_performed` AND `critical_actions` empty — if either has a value, the partial summary is kept.

### Changes

**File: `supabase/functions/parse-inspection-docx/index.ts`**

1. **Upgrade model** from `google/gemini-2.5-flash` to `google/gemini-2.5-pro` — the timeout safeguards already protect against hanging, and Pro produces significantly more complete and accurate extractions

2. **Improve summary merge logic** in the second-pass retry — replace summary from second pass if it has more content (compare field lengths), not just if first pass fields are empty

3. **Add systems/ziplines/standards to second-pass retry** — currently only retries equipment and summary; large reports can also truncate systems and ziplines

4. **Log the extracted text length per section** for debugging — after extraction, log how many chars of comments were captured across all items

**File: `src/pages/NewInspection.tsx`**

5. **No changes needed** — the client-side mapping and insertion logic is correct. All fields (comments, production_year, rope_type, summary sections) are already properly mapped. Equipment quantity is already excluded.

### Technical Detail

```text
Model change:
  model: "google/gemini-2.5-flash"  →  model: "google/gemini-2.5-pro"

Second-pass merge improvement:
  Before: Only merges summary if BOTH repairs_performed AND critical_actions are empty
  After:  Merges summary if second pass has more total content (sum of field lengths)

  Before: Second pass only retries equipment + summary
  After:  Second pass retries ALL sections, merges any that have more items than first pass

Second-pass prompt update:
  "Extract ALL sections: systems, equipment (NO quantity), ziplines, standards, and summary.
   Include every item with full verbatim comments."
```

### Files

| File | Change |
|------|--------|
| `supabase/functions/parse-inspection-docx/index.ts` | Upgrade to gemini-2.5-pro, improve second-pass retry to cover all sections with better merge logic |

