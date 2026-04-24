

## P3 — Unify sync-path logging behind syncLog

**Problem.** Sync code currently uses two inconsistent gates:
- `syncLog.log(...)` — respects `localStorage.debug_sync` runtime toggle (works in production for field debugging)
- `if (import.meta.env.DEV) console.log(...)` — only ever prints in dev builds, no field toggle

This means turning on `debug_sync=1` in production reveals only ~half the sync trace, which is the exact moment you most need full visibility.

**Decision.** `syncLog` wins. It already covers the dev-build case (`isDev` short-circuits to always-on) AND the runtime toggle. The raw `import.meta.env.DEV` gates are strictly weaker.

### Scope

Replace `if (import.meta.env.DEV) console.log/warn(...)` patterns inside sync-path files with `syncLog.log/warn(...)`. Leave `console.error` alone — `syncLog.error` already passes through unconditionally, but rewriting all error sites is churn for no behavior change; only convert errors that sit next to a converted log for readability.

Files in scope (sync-path only — not UI, not unrelated features):
- `src/lib/sync-manager.ts`
- `src/lib/atomic-sync-manager.ts`
- `src/lib/sync-reconciliation.ts`
- `src/lib/sync-quarantine.ts`
- `src/lib/deferred-reconcile.ts`
- `src/lib/background-sync.ts`
- `src/lib/sync-events.ts`
- `src/hooks/useAutoSync.tsx`
- `src/hooks/useReportSync.tsx`
- `src/hooks/useBackgroundSync.tsx`

Out of scope: photo upload pipeline, auth, UI components, edge functions. Those have their own logging conventions and aren't part of the sync trace the `debug_sync` flag is meant to surface.

### Plan

1. Grep each file for `import.meta.env.DEV` and `console.log|console.warn` outside of `logError`/`syncLog` calls.
2. For each match in the sync-path files above:
   - Add `import { syncLog } from '@/lib/sync-logger'` if missing.
   - Replace `if (import.meta.env.DEV) console.log(...)` → `syncLog.log(...)`.
   - Replace `if (import.meta.env.DEV) console.warn(...)` → `syncLog.warn(...)`.
   - Replace bare `console.log(...)` that is clearly a sync-trace breadcrumb → `syncLog.log(...)`. Skip prints that look like one-time boot diagnostics.
3. Leave `console.error` alone unless adjacent to a converted log.
4. Spot-check `useAutoSync` (the unsynced-counts coalescer) since it's the highest-traffic site.

### Technical details

- No behavior change in production with `debug_sync` unset (`syncLog.log` is a no-op).
- No behavior change in dev (`isDev=true` makes `syncLog.log` always print, matching the prior `import.meta.env.DEV` gate).
- New behavior in production with `debug_sync=1`: **all** sync-path breadcrumbs print, not just half. This is the desired outcome.
- No new files, no schema change, no test changes required. Existing `sync-logger.ts` is the single source of truth.
- Bundle impact: negative — fewer inline `import.meta.env.DEV` branches.

