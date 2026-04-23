

## PR 7 Status Audit & Remaining Work

### Status of each item

| Item | Status | Evidence |
|---|---|---|
| **H5** — Realtime effect doesn't churn on `hasUnsavedChanges` | ✅ Done | `InspectionForm.tsx` lines 520–548: deps are `[id]` only; effect reads `hasUnsavedRef.current` inside the handler. Comment explicitly references H5. |
| **H6** — Sign-out cancels in-flight refresh + clears caches | ✅ Done | `cached-auth.ts` `signOutWithAbort()` (lines 117–134) flips `refreshAborted`, awaits/races the pending refresh (1s cap), then `signOut()`. `AuthenticatedHeader.tsx` calls it. `invalidateUserCache()` sweeps in-memory + namespaced localStorage on `SIGNED_OUT`. |
| **H8** — Derive Supabase storage key from env | 🟡 **Partial** | `cached-auth.ts:32` and `main.tsx:20` derive it. **`src/pages/Index.tsx` lines 18 & 70 still hardcode `sb-ssgzcgvygnsrqalisshx-auth-token`.** |
| **H9** — `new URL()` parsing in `backup-photo-storage` | ❌ **Not done** | `extractStoragePath()` (lines 76–88) still uses `indexOf` + `substring`. |
| **L1** — `_shared/cors.ts` | ❌ **Not done** | `corsHeaders` is duplicated in 34 edge-function files. `_shared/rate-limiter.ts` *consumes* it as a param but no shared export exists. |
| **L2** — Targeted `as any` cleanup | 🚫 Skip | 942 occurrences across 45 files; mostly necessary `(supabase.from(table as any) as any)` wrappers for dynamic table names that the generated `Database` type can't model. Low ROI; deferred. |
| **L3** — `logError()` helper | ❌ **Not done** | No `logError` / `Sentry` references. All errors `console.error` only. |
| **L6** — DOMPurify in `chart.tsx` | 🚫 Not applicable | The `<style>` injection is fully **internally generated** from a static `THEMES` const + numeric `id` + theme-driven CSS color values. There is **no user-supplied input**. Sanitizing CSS with DOMPurify (an HTML sanitizer) wouldn't apply. Recommend leaving as-is (and noting the rationale in a code comment). |
| **L9** — Remove pre-emptive refresh in `cached-auth.ts` | ❌ **Not done** | Lines 244–266 still manually pre-emptively refresh inside the 5-min window. Supabase v2 `autoRefreshToken: true` (set in `client.ts`) handles this. |
| **L10** — `.env` in `.gitignore` | 🟡 **Partial** | `.gitignore` contains `*.local` (covers `.env.local`) but **not `.env` itself**. Lovable Cloud's auto-managed `.env` contains only the publishable key + URL (no secrets), so leak risk is effectively zero — but adding `.env` for safety/convention is trivial. |

---

### Plan to close H8, H9, L1, L3, L9, L10

#### H8 — Finish env-derived storage key
**`src/pages/Index.tsx`** lines 18 & 70: replace the hardcoded literal with the same pattern used in `cached-auth.ts`:
```ts
const SUPABASE_SESSION_KEY = `sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`;
const cachedSession = localStorage.getItem(SUPABASE_SESSION_KEY);
```
Define the constant once at module scope.

#### H9 — `new URL()` parsing in `backup-photo-storage`
Replace `extractStoragePath()` body in `supabase/functions/backup-photo-storage/index.ts`:
```ts
function extractStoragePath(url: string): string {
  if (!url) return "";
  // Already a relative path (no scheme) → return as-is
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    // Storage URLs: /storage/v1/object/{public|authenticated|sign}/{bucket}/{path}
    const parts = u.pathname.split("/").filter(Boolean);
    const objIdx = parts.indexOf("object");
    if (objIdx === -1) return "";
    // Skip "object" + access-mode (public/authenticated/sign) + bucket name
    const bucketIdx = objIdx + 2;
    if (parts.length <= bucketIdx + 1) return "";
    const bucket = parts[bucketIdx];
    if (!PHOTO_BUCKETS.includes(bucket as any)) return "";
    return parts.slice(bucketIdx + 1).join("/");
  } catch {
    return "";
  }
}
```
Robust against query strings, double-slashes, and signed-URL variants.

#### L1 — Shared CORS module
Create **`supabase/functions/_shared/cors.ts`**:
```ts
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
} as const;
```
Migrate the 34 edge functions to `import { corsHeaders } from "../_shared/cors.ts";`. Three functions use a shorter header set (`sync-offsite-backup`, `generate-backup-pdfs`, `backup-photo-storage`, `preview-transactional-email`) — they keep their local override (or use the shared one + add the missing platform headers, which is harmless). Done file-by-file in one PR.

#### L3 — `logError()` helper
Create **`src/lib/log-error.ts`**:
```ts
export interface LogContext {
  scope?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

export function logError(err: unknown, ctx: LogContext = {}): void {
  const payload = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    scope: ctx.scope,
    userId: ctx.userId,
    extra: ctx.extra,
    ts: new Date().toISOString(),
    appVersion: import.meta.env.APP_VERSION,
  };
  console.error("[logError]", payload);
  // Forward to backend audit_logs (best-effort, no await blocking caller)
  try {
    void import("@/integrations/supabase/client").then(({ supabase }) =>
      supabase.rpc("create_audit_log", {
        p_action_type: "client.error",
        p_table_name: "client",
        p_record_id: null,
        p_old_values: null,
        p_new_values: null,
        p_metadata: payload as any,
      }).catch(() => {})
    );
  } catch { /* ignore */ }
}
```
This gives a single forwarding seam. **Do not** mass-replace existing `console.error` calls — leave them and adopt `logError` at new call sites + the top 5 highest-signal existing sites (sync manager, sign-out, photo upload, completion lock, attestation).

#### L9 — Remove pre-emptive refresh
In **`src/lib/cached-auth.ts`** delete lines 243–266 (the `try { const session = localStorage.getItem(SUPABASE_SESSION_KEY); … } catch {}` block). Supabase v2's `autoRefreshToken: true` (already set in `client.ts`) handles refresh ~5 min before expiry. The `signOutWithAbort` machinery still works because `refreshSessionSingleFlight` remains exported for the (rare) explicit-refresh path; it just won't be called pre-emptively from `getUserWithCache`.

#### L10 — Add `.env` to `.gitignore`
Append to **`.gitignore`**:
```
# Lovable Cloud auto-managed env (publishable values only)
.env
.env.*
!.env.example
```

---

### Files touched
- `src/pages/Index.tsx` — H8
- `supabase/functions/backup-photo-storage/index.ts` — H9
- `supabase/functions/_shared/cors.ts` *(new)* — L1
- `supabase/functions/**/index.ts` (34 files) — L1 import migration
- `src/lib/log-error.ts` *(new)* — L3
- `src/lib/cached-auth.ts` — L9
- `.gitignore` — L10

### Out of scope / explicitly deferred
- **H5, H6** — already implemented; no changes
- **L2** — 942-site `as any` cleanup is low-ROI churn; defer until a typed wrapper for dynamic table names exists
- **L6** — `chart.tsx` injects only internally-generated CSS from a static `THEMES` map + numeric id; no user input crosses into the `<style>` block. Add a one-line code comment noting why DOMPurify isn't needed instead of importing it for a no-op.

### Risk
Low across the board. H8/H9/L9/L10 are surgical. L1 is a mechanical import migration (could land in chunks). L3 is purely additive. Chart.tsx and `as any` cleanup explicitly skipped with rationale.

