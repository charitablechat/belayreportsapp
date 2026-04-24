---
name: supabase-transmit-guard
description: C5 — synthetic-session-guard helpers (isUnsafeToTransmit + looksLikeJwt) gate two transmit boundaries — the sync pipeline (assertRealSessionForSync) and edge-function invokes (safeFunctionsInvoke); src/integrations/supabase/client.ts cannot host a global guard because it is auto-generated and off-limits
type: constraint
---

The offline placeholder token (`offline_placeholder_token`, defined in `src/lib/synthetic-session-guard.ts`) must never reach the network. Two boundaries enforce this in code:

1. **Sync pipeline.** `assertRealSessionForSync` in `src/lib/atomic-sync-manager.ts:120` runs before every inspection / training / daily-assessment batch. On placeholder detection it surfaces a user-visible "Session expired" toast (`sync-session-invalid` id) and aborts. Locked by `mem://constraints/sync-session-jwt-guard`.

2. **Edge-function invokes.** `safeFunctionsInvoke` in `src/lib/safe-functions-invoke.ts` wraps `supabase.functions.invoke` with the same pre-flight (`isUnsafeToTransmit` + `looksLikeJwt`) and returns a typed `{ data: null, error: { name: 'OfflinePlaceholderTokenError' | 'InvalidSessionTokenError', message } }` result. Drop-in replacement at any opt-in call site. Contract tests in `src/lib/__tests__/safe-functions-invoke.test.ts`.

**Why we don't install a global `fetch` interceptor in the Supabase client.** `src/integrations/supabase/client.ts` is auto-generated and the system prompt explicitly forbids edits. A per-boundary helper is the only way to wire the guard without violating that constraint.

**Why `safe-functions-invoke` fails open on `getSession()` errors.** Matches `assertRealSessionForSync`'s posture: a transient storage read failure should not block legitimate calls. The underlying `supabase.functions.invoke` will still surface a 401 if the session is genuinely missing.

**Migration policy for existing `supabase.functions.invoke` call sites.** ~20+ call sites currently exist (search `supabase.functions.invoke` in `src/`). They are not bulk-rewritten — opt in case-by-case when a call site demonstrably needs the guard (e.g. background-triggered invokes that may run while the auth state machine is still in OFFLINE_AUTHENTICATED). User-initiated foreground invokes are typically fine without the wrapper because the user just authenticated.
