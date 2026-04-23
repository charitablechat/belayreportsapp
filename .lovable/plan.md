

## L6 — Toast/notification coupling

This is a code-organization observation, not a defect. No code change recommended now.

### Current state
- `src/lib/toast-helpers.ts` already centralizes `toast.*` + notification-center routing (mobile-aware), and is the canonical entry point (`toastSuccess`, `toastError`, `toastProgress`, etc.).
- `src/lib/sync-events.ts` already centralizes sync lifecycle events (`emitSyncComplete`, `onSyncComplete`, remote-deleted bus, pending-remote-update bus, active-form registry).
- The "coupling" is that some sync-adjacent modules still call `toast.success(...)` and `addSyncNotification(...)` directly instead of routing through `toast-helpers` or emitting a single `syncEventBus` signal that one subscriber translates into UX.

### Why defer
- Both surfaces are already abstracted; the remaining direct calls are intentional (e.g. terminal-styled `HARD-SAVED` toast, error toasts that must always show).
- A new `syncEventBus` layer would duplicate `sync-events.ts` for stylistic uniformity only — zero behavior change, non-trivial churn across `useAutoSync`, `atomic-sync-manager`, `background-sync`, photo-sync, and the notification-center.
- Risk/reward is poor: every touched call site is a chance to drop a notification or double-fire one.

### Recommendation
- Keep as-is. If a future change adds a *new* sync notification surface (e.g. in-app activity feed, push-notification mirror), introduce `syncEventBus` at that point and migrate call sites opportunistically — touching the files anyway is the right time.
- Soft rule going forward: new sync-side modules should call `toastSuccess/toastError` from `toast-helpers` and emit via `sync-events.ts`, not call `toast.*` / `addSyncNotification` directly.

No files edited. L6 acknowledged as a style/coupling note.

