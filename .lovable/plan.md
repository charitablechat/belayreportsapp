

## Fix 2.B — Surface emergency-fallback failures in `SyncDiagnosticsSheet`

### Status check

Gap 2.2 already did the heavy lifting in `src/lib/offline-storage.ts`:

- `emergencyLocalStorageFallback` already classifies errors (`localstorage_quota` / `localstorage_blocked` / `localstorage_unknown`).
- It already `console.error`s, forwards to `logError`, fires `addSyncNotification`, and writes to a `sessionStorage` ring buffer (max 20).
- `getEmergencyFallbackFailures()` is already exported.

What's missing from 2.B is the **diagnostics-panel visibility**: the data is recorded but `SyncDiagnosticsSheet` never reads or renders it. This plan closes that single remaining gap.

### Plan

#### 1. `SyncDiagnosticsSheet.tsx` — add a "Records lost this session" section

When the sheet opens (and on every visibility refresh), call `getEmergencyFallbackFailures()` and render the result.

UI layout (only renders when `failures.length > 0`):
- Section header: **"Records lost this session"** with a count badge.
- Red glassmorphism card (`bg-destructive/10 border-destructive/40`) — same visual language as `SaveFailureBanner` so the failure mode is recognizable.
- One-line explanation: "These records could not be saved to local storage. Reload may clear them — copy/screenshot before reloading."
- Compact list (max 20 rows, FIFO from the ring buffer):
  - Relative timestamp (e.g. "2 min ago") — use existing `date-fns` `formatDistanceToNow`.
  - Report type + truncated id (`inspection · 9f3a1b2c…`).
  - Failure code badge (`quota` / `blocked` / `unknown`) with color coding (quota=destructive, blocked=warning, unknown=muted).
  - Operation name (small muted text).
  - Approx bytes (e.g. `~12 KB`) right-aligned.
- "Copy diagnostics" button at the bottom of the section that copies the full JSON of the failures array to clipboard for support escalation. Reuses the same clipboard pattern as `SaveFailureBanner` (try `navigator.clipboard.writeText`, fall back to a textarea).

When `failures.length === 0`, render nothing for this section (no empty state — keeps the sheet uncluttered when healthy).

#### 2. Refresh behavior

Read failures into local state on:
- Sheet open (existing `useEffect` keyed on `open`).
- Existing periodic refresh tick if the sheet has one; otherwise add a 5-second `setInterval` while open.

This matches how the existing photo-failures panel (Fix 1.C) refreshes — to be confirmed during implementation by reading the current `SyncDiagnosticsSheet.tsx`. If it already polls, just piggyback on the same interval.

#### 3. No new module, no new exports, no DB changes

`getEmergencyFallbackFailures` is already exported from `offline-storage.ts`. The ring buffer already lives in `sessionStorage`. No additional plumbing.

### Out of scope

- No additional persistence (sessionStorage ring buffer already exists; promoting it to IDB defeats the purpose since IDB is the system that just failed).
- No admin-side dashboard surfacing (audit_logs already capture the same data via `logError`; this gap is purely about end-user visibility in the on-device diagnostics sheet).
- No changes to `emergencyLocalStorageFallback` itself or to the recording helper — Gap 2.2 finalized those.
- No changes to the photo-failures panel (Fix 1.C) — both panels coexist as siblings.

### Files touched

1. **`src/components/pwa/SyncDiagnosticsSheet.tsx`** — add the "Records lost this session" section, hook into the existing refresh cycle, copy-to-clipboard action.

