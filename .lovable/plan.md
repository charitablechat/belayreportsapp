

User wants **collaborative merge** for reports: when 2+ devices edit the same report (online or offline), changes from all devices should combine into one report, not overwrite each other.

## Current state (from memory + code)

- **LWW (Last-Write-Wins)** at row level, silent. `useConflicts` resolves by `updated_at` — newest wins, loser's edits are **lost**.
- `sync_conflicts` table exists but is auto-resolved with no merge.
- Reports have **parent rows** (`inspections`, `trainings`, `daily_assessments`) + **child rows** (`systems`, `ziplines`, `equipment`, `standards`, `inspection_photos`, etc.).
- Atomic sync replaces temp-IDs with UUIDs.

## The real problem

LWW is **fine for child rows** (each system/zipline/equipment is a separate row with its own UUID — two devices adding different items naturally merge via insert). The data loss happens on the **parent row's free-text fields**: `summary`, `observations`, `recommendations`, `notes`, `next_steps`, `inspector_name`, etc. Whichever device syncs last overwrites the other's text.

So the fix is two-pronged:

### Part 1 — Child rows (already 90% working, needs hardening)
- Inserts merge naturally: Device A adds 3 ziplines, Device B adds 2 — sync produces 5. ✅
- Edits to the **same child row** still hit LWW. Acceptable for short fields like `result` (Pass/Fail) — last edit wins is reasonable.
- **Deletes** are the danger: Device A edits zipline #7 while Device B deletes it. Per `sync-deletion-reconciliation` memory, orphan reconciliation soft-deletes — this could destroy A's edits. Need a "tombstone wins only if newer than the edit" rule.

### Part 2 — Parent free-text fields (the actual data-loss zone)
Three viable strategies, ranked:

**Option A — Field-level LWW (recommended, lowest risk)**
- Track `updated_at` per field in a sidecar JSONB column: `field_timestamps: { summary: "...", observations: "...", ... }`.
- On sync, for each field independently: keep whichever side has the newer timestamp.
- Result: Device A edits `summary`, Device B edits `observations` → both preserved. If both edit `summary` → newer wins (same as today, but only that one field is lost, not the whole row).
- ~80% of real-world conflicts disappear because users typically work on different sections.

**Option B — Three-way merge with conflict markers**
- Store `last_synced_snapshot` per device. On sync, diff local vs snapshot vs server. Non-overlapping changes auto-merge; overlapping changes get inline markers (`<<<<<<< local ... ======= ... >>>>>>> remote`) the user must resolve.
- Most powerful, but requires a conflict-resolution UI and breaks "silent resolution" rule from memory.

**Option C — CRDT (Yjs / Automerge) on rich-text fields**
- True collaborative editing, character-level merge. Works offline, syncs perfectly.
- Heavy: requires Yjs integration in TipTap, a sync server (or peer-to-peer via Supabase Realtime), conflict-free document storage. Massive scope expansion.

### Part 3 — Photos
Already merge-safe (each photo is its own row with unique `photo_url`). No change needed.

### Part 4 — Attestation
Only one signature per report. **First-signed wins** — once `attestation_signed_at` is set, sync must never overwrite it. Subsequent device's attestation (if user signed twice) is dropped silently.

## Recommendation: Option A + delete-vs-edit guard

Keeps the silent-resolution UX, requires no new UI, fixes the 80% case where users edit different sections.

## Implementation outline

### Schema (migration)
```sql
ALTER TABLE inspections ADD COLUMN field_timestamps JSONB DEFAULT '{}'::jsonb;
ALTER TABLE trainings ADD COLUMN field_timestamps JSONB DEFAULT '{}'::jsonb;
ALTER TABLE daily_assessments ADD COLUMN field_timestamps JSONB DEFAULT '{}'::jsonb;

-- Tombstones for child rows: track soft-delete time so edit-after-delete wins
-- (deleted_at column already exists on most child tables; add to ones missing it)
```

### Client write path (`src/lib/non-blocking-save.ts` + form pages)
- Wrap every field-level update: when user changes `summary`, also write `field_timestamps.summary = new Date().toISOString()`.
- Helper: `setFieldWithTimestamp(record, field, value)`.

### Sync merge (`src/lib/atomic-sync-manager.ts`)
- New helper `mergeRecordFields(local, remote)`:
  1. For each tracked field, compare `local.field_timestamps[field]` vs `remote.field_timestamps[field]`. Keep newer.
  2. Merge `field_timestamps` objects (newest per key).
  3. **Skip attestation fields** entirely if remote has `attestation_signed_at` set — first-sign wins.
  4. Return merged record; push to server with single update.
- Replace current "local wins / remote wins" branch in conflict resolution with `mergeRecordFields`.

### Child row delete-vs-edit guard
- When sync would soft-delete an orphaned child row, check: is `child.updated_at > parent_sync.last_pulled_at`? If yes, the row was edited on another device after the delete — skip the soft-delete (resurrect / keep).

### Realtime presence (small bonus)
- When two users are online editing the same report simultaneously, show a subtle banner: *"[Name] is also editing this report"* using Supabase Realtime presence. Pure awareness, no blocking. Helps prevent conflicts before they happen.

### Files touched

- **NEW migration** — `field_timestamps` columns on 3 report tables
- **EDIT** `src/lib/atomic-sync-manager.ts` — merge logic
- **EDIT** `src/hooks/useConflicts.tsx` — call merge instead of LWW
- **EDIT** `src/lib/non-blocking-save.ts` — write field timestamps
- **EDIT** form pages (`InspectionForm`, `TrainingForm`, `DailyAssessmentForm`) — use `setFieldWithTimestamp` helper
- **NEW** `src/lib/field-merge.ts` — pure merge helpers + tests
- **NEW** (optional) `src/components/CollaboratorPresence.tsx` — Realtime presence banner
- **EDIT** `mem://features/silent-conflict-resolution-v6` → bump to v7 with field-level merge

### What this does NOT do
- No real-time collaborative typing (use Option C / CRDTs for that)
- No conflict UI — merge stays silent per your existing rule
- No version-vector / vector-clock — relies on wall-clock timestamps (acceptable since clock-skew tolerance already exists in `local-data-guards.ts`)

## Question before I build

**Do you want the Realtime presence banner** (Part 4 bonus — shows "Sarah is also editing" when 2 users open the same report online)? It's ~50 LOC and significantly reduces conflicts by warning users in advance.

- **Yes** — add presence banner
- **No** — silent merge only, no UI

Reply Yes/No (or "Option B" / "Option C" if you want a different merge strategy) and I'll execute.

