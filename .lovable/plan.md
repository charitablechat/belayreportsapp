

## L7 — Per-device sync batch size

Acknowledged as a minor tuning observation. Recommend a small, low-risk change: derive the batch size from `isMobile()` (same helper photo sync already uses) instead of a single global constant.

### Change

In `src/hooks/useAutoSync.tsx` (around the `MAX_BATCH_SIZE = 5` constant near lines 210-216):

- Replace the module-level constant with a per-cycle value:
  - Mobile: `5` (unchanged — current behavior preserved)
  - Desktop: `15` (3× throughput on capable machines, well below Postgres/PostgREST comfort)
- Source: `isMobile()` from `src/lib/mobile-detection.ts` (already imported elsewhere in the sync layer; matches the pattern `syncPhotos` uses for `photoConcurrency`).
- Keep the name `MAX_BATCH_SIZE` as a `const` computed once per hook instantiation so behavior inside a session is stable and logs stay readable.

### Why this and not more
- Mirrors the existing mobile/desktop split already proven in `sync-manager.ts` (3 vs 5 photo concurrency). No new config surface, no new env var, no settings UI.
- Bounded: 15 is conservative — each record is one PostgREST call; 15/cycle on desktop is still gentle.
- Reversible: single constant, easy to tune later if telemetry shows issues.

### Out of scope
- No user-facing setting.
- No adaptive/network-quality-based sizing (would need real measurement; not worth it for a backlog drainer that already runs every few seconds).
- No change to photo batch size (`MAX_PHOTO_BATCH_SIZE = 30` in `sync-manager.ts`) — already tuned.

### Files touched
- `src/hooks/useAutoSync.tsx` — one constant becomes one `isMobile() ? 5 : 15` expression; add `isMobile` import if not already present.

No DB, no edge functions, no UI changes.

