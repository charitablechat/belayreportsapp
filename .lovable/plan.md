

## Fix: Buffer is not defined in Deno Edge Function

### Problem

`Buffer` is a Node.js global that doesn't exist in the Deno runtime used by edge functions. The `mammoth`, `word-extractor`, and `pdf-parse` libraries were called with `Buffer.from(fileBuffer)` which crashes immediately.

### Solution

Replace all three `Buffer.from(fileBuffer)` calls with `new Uint8Array(fileBuffer)` — all three libraries accept `Uint8Array` as input. Alternatively, import Buffer from Node compat: `import { Buffer } from "node:buffer";`

### Changes

**File: `supabase/functions/parse-inspection-docx/index.ts`**

Add `import { Buffer } from "node:buffer";` at the top of the file (after the npm imports). This is Deno's Node compatibility layer and provides the `Buffer` global these npm libraries expect.

| File | Change |
|------|--------|
| `supabase/functions/parse-inspection-docx/index.ts` | Add `import { Buffer } from "node:buffer";` at top |

