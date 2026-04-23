

## S36 — Gate sync console noise behind a DEV / debug flag

### Problem

`src/lib/atomic-sync-manager.ts` emits ~60 unconditional `console.log` calls per sync cycle, including the colorized `[SYNC_TERMINAL] align_synced_at CONFIRMED` line (3 copies — inspection, training, assessment). In production these all run, polluting devtools and adding measurable string-formatting overhead on Safari/iOS. Only a handful of late additions (L2719/2748/2777) bother to gate on `import.meta.env.DEV`.

### Fix

Introduce a single shared debug logger and route every sync log through it. The logger is silent in production unless a localStorage opt-in flag is set, so we keep field-debugging access for support cases.

### Changes

**New: `src/lib/sync-logger.ts`**

```ts
const isDev = import.meta.env.DEV;
let runtimeForce: boolean | null = null;

function isDebugEnabled(): boolean {
  if (isDev) return true;
  if (runtimeForce !== null) return runtimeForce;
  try {
    runtimeForce = localStorage.getItem('debug_sync') === '1';
  } catch {
    runtimeForce = false;
  }
  return runtimeForce;
}

export const syncLog = {
  log:  (...a: unknown[]) => { if (isDebugEnabled()) console.log(...a); },
  warn: (...a: unknown[]) => { if (isDebugEnabled()) console.warn(...a); },
  // errors always pass through — operational signal
  error: (...a: unknown[]) => console.error(...a),
};
```

**Edit: `src/lib/atomic-sync-manager.ts`**

1. Add `import { syncLog } from './sync-logger';` near the top.
2. Mechanical replace of `console.log(` → `syncLog.log(` for every call inside this file (~60 sites). The three `[SYNC_TERMINAL] align_synced_at CONFIRMED` blocks (L779, L1641, L2434) flow through `syncLog.log` unchanged — same colorized output, but only when DEV or `localStorage.debug_sync === '1'`.
3. Replace the existing `if (import.meta.env.DEV) console.log(...)` lines at L2719/2748/2777 with plain `syncLog.log(...)` for consistency.
4. Leave `console.error` and `console.warn` calls alone — those are real operational signal and stay visible in production.

**Out of scope**

- `sync-manager.ts`, `useAutoSync.tsx`, `offline-storage.ts`: their logs are mostly already gated on `import.meta.env.DEV`. A future pass can route them through `syncLog` for uniformity, but they're not the source of the noise S36 names.
- Rewriting `console.error`/`console.warn` — keep production diagnostics intact.
- Build-time stripping (`drop_console`) — the runtime opt-in (`localStorage.debug_sync = '1'`) is the explicit goal so we can ask field users to flip it on without redeploying.

### Risk

Negligible. Pure log gating; no behavior change. The colorized terminal line still appears when developers want it (DEV builds, or production with the flag flipped). Errors are unaffected.

### Verification

- `npx tsc --noEmit`.
- Manual prod build: trigger 3 sync cycles, confirm zero `[Atomic Sync]`/`[SYNC_TERMINAL]`/`[SYNC]`/`[SAFETY]` lines in the console.
- Manual prod build: `localStorage.setItem('debug_sync','1')`, reload, sync once, confirm full log stream returns including the colorized align_synced_at line.
- Manual DEV build: logs unchanged from today.

