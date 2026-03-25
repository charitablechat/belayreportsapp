

## Fix Import Timeout Issue

### Root Cause

Two compounding issues:

1. **Slow AI model**: `gemini-2.5-pro` with 60K chars of text and tool calling can take 30-90+ seconds. This pushes close to or beyond the edge function execution limit.
2. **No client-side timeout**: The `fetch` call in `NewInspection.tsx` (line 199) has no `AbortController` — the UI spinner runs indefinitely if the edge function is slow or hangs.

The edge function logs confirm this: the function boots, extracts text, then blocks on the AI gateway call with no safeguard.

### Changes

**File: `supabase/functions/parse-inspection-docx/index.ts`**

1. Switch model from `google/gemini-2.5-pro` to `google/gemini-2.5-flash` — significantly faster while still accurate for structured extraction with tool calling
2. Add a 90-second `AbortSignal.timeout()` on the AI gateway fetch to prevent the edge function from hanging indefinitely
3. Return a clear timeout error message if the AI call exceeds the limit

**File: `src/pages/NewInspection.tsx`**

4. Add an `AbortController` with a 120-second timeout on the edge function fetch call
5. Show a specific toast message when the import times out ("Import took too long — try a smaller file or different format")
6. Clean up the abort controller on unmount/re-import

### Technical Detail

```text
Edge function AI call:
  Before: fetch(aiGateway, { ... })           // no timeout
  After:  fetch(aiGateway, { signal: AbortSignal.timeout(90_000) })

Client fetch:
  Before: fetch(edgeFn, { ... })              // no timeout  
  After:  const ctrl = new AbortController()
          setTimeout(() => ctrl.abort(), 120_000)
          fetch(edgeFn, { signal: ctrl.signal })
```

The model switch alone should reduce typical response times from 30-90s down to 10-30s, making timeouts rare. The abort signals are safety nets.

### Files

| File | Change |
|------|--------|
| `supabase/functions/parse-inspection-docx/index.ts` | Switch to flash model, add 90s timeout on AI fetch |
| `src/pages/NewInspection.tsx` | Add 120s AbortController timeout, timeout-specific error message |

