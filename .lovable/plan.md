## H8: Make version numbering atomic across tabs

**Problem:** `versionCounters` in `src/lib/report-version-manager.ts` is a per-tab in-memory `Map`. With the same report open in two tabs, both seed from IDB, both compute the same `nextVersion`, and both write rows with identical `versionNumber`. The rows survive (UUID keys), but the UI shows duplicate "v4" entries and "Restore v4" becomes ambiguous.

## Fix

Drop the in-memory counter and assign `versionNumber` inside the same `readwrite` transaction that writes the new row. IDB transactions serialize within an origin across tabs, so a read-then-write inside one `readwrite` tx is atomic against any other tab doing the same.

### Changes — `src/lib/report-version-manager.ts`

1. **Remove** the module-level `versionCounters` Map and all reads/writes to it.
2. **Rewrite** the version-assignment block in `appendVersion`:
   - Open a single `readwrite` transaction on `report_versions`.
   - Inside it, call `index('by-report').getAll(reportId)` (or iterate the index with a cursor in reverse for efficiency) to find the current max `versionNumber`.
   - Compute `nextVersion = max + 1`.
   - `put` the new version row in the same transaction.
   - `await tx.done`.
3. Keep everything else (HTML stripping, prune call, dev logging) unchanged.

### Why this works

`indexedDB` guarantees that two `readwrite` transactions on the same object store run serially. Tab A's read+write completes before Tab B's transaction starts, so Tab B sees A's row when computing its own max. No collisions, no extra coordination layer (BroadcastChannel, locks) needed.

### Verification

- `npx tsc --noEmit`.
- Manual: open the same report in two browser tabs, save in both rapidly, confirm Version History shows distinct sequential version numbers (no duplicate "vN").
