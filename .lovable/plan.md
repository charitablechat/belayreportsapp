

## S38 — Standardize log id truncation to 8 chars

### Finding

Sync logs overwhelmingly use `.substring(0, 8)` for id prefixes (24 sites in `src/lib/atomic-sync-manager.ts` alone, plus matching usage in `useAutoSync.tsx`, `sync-manager.ts`, and elsewhere). Two outliers truncate to 12:

- `src/lib/offline-storage.ts:1258` — `[Offline Storage] Inspection flagged unsynced` log.
- `src/lib/offline-storage.ts:2800` — `[Offline Storage] ${storeName} flagged unsynced` log.

Both are DEV-gated diagnostic logs. They're the only two `substring(0, 12)` calls in `src/lib/` and `src/hooks/`.

Note: `syncProgressEmitter` itself does not truncate ids — it carries `currentItem` strings supplied by callers in `atomic-sync-manager.ts`, which already use `substring(0, 8)`. The inconsistency the user flagged lives in the surrounding sync log lines, not the emitter payload.

### Fix

In `src/lib/offline-storage.ts`, change both `String(...).substring(0, 12)` calls to `.substring(0, 8)` so every sync-related log prefix matches.

```ts
// L1258
id: String(record.id).substring(0, 8),
// L2800
id: String(i.id).substring(0, 8),
```

### Out of scope

- Introducing a shared `shortId(id)` helper. Worth doing eventually, but a 2-line tidy is the right scope for S38 — a helper-introduction touches ~25 sites and deserves its own ticket.
- Touching the `og-share.ts` `toShortHash` function (8 chars, unrelated — used for public share URLs, not logs).
- Truncations in non-sync code paths.

### Risk

None. DEV-only logs; shorter prefix is still unique enough to correlate against the 8-char ids used by every other sync log.

### Verification

- `npx tsc --noEmit`.
- `grep -rnE "substring\(0,\s*12\)" src/lib/ src/hooks/` returns zero matches post-edit.
- Manual DEV: trigger a sync with an unsynced record, confirm `[Offline Storage]` and `[Atomic Sync]` log lines now show matching 8-char id prefixes for the same record.

