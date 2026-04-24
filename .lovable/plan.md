

## Plan — Belt-and-braces on temp→UUID child rewrite + concurrent-edit regression lock

Two additions, both test-only (no behavioural code changes). Goal: lock in the contracts the audit relied on so a future refactor can't silently break them.

### 1. Temp→UUID child rewrite contract test

**New file: `src/lib/__tests__/temp-uuid-child-rewrite.test.ts`**

The sync pipeline transforms `temp-*` parent IDs to real UUIDs and must rewrite every child row's foreign key in the same transaction. We already have `assertNoTempIds` / `assertNoTempIdsInArray` (sw-sync-validators.ts) as the fail-loud guard. This test locks in three properties:

- **Guard contract**: feed a mixed array (one good UUID, one `temp-` row) to `assertNoTempIdsInArray` and assert it throws naming the offending id and the call-site context. Already covered partly in `sw-sync-guards.test.ts` — extend with the child-table call-site labels actually used in `atomic-sync-manager.ts` (`inspection_systems.upsert`, `inspection_ziplines.upsert`, `inspection_equipment.upsert`, `inspection_standards.upsert`, `training_*`, `daily_assessment_*`).
- **Rewrite completeness**: build a synthetic in-memory parent + children payload where parent.id = `temp-abc` and every child's FK points at `temp-abc`. Run it through the pure rewrite helper in `atomic-sync-manager.ts` (extract a small pure `rewriteChildForeignKeys(children, tempId, realUuid)` if one isn't already exported — read-only for now; if not exported, the plan extracts it in step 1a). Assert: zero `temp-` strings remain anywhere in the output, every child FK now equals the real UUID, and row counts are preserved.
- **Negative case**: passing `realUuid === tempId` (no-op) returns the input untouched (no accidental clones).

**Step 1a (only if needed):** if `atomic-sync-manager.ts` keeps the rewrite logic inline, extract it into a tiny exported pure function `rewriteChildForeignKeys(children, tempId, realUuid, fkColumnByTable)` in the same file. The existing call site changes one line. No behavioural change — just makes the contract testable without spinning up the whole sync.

### 2. Concurrent-edit (field-level merge) regression lock

**New file: `src/lib/__tests__/field-merge-concurrent-edit.test.ts`**

`src/lib/field-merge.ts` already has `mergeRecordFields` and `field-merge.test.ts` covers basic per-field LWW. The audit relied on three subtler properties that aren't currently locked:

- **Two devices, disjoint fields, both win**: device A edits `organization` at T+1, device B edits `location` at T+2, neither touched the other field. Merge result: A's organization + B's location, both per-field timestamps preserved in `field_timestamps`. Run the merge in both directions (A∪B and B∪A) and assert symmetric result.
- **Same field, both devices, newest wins by per-field timestamp even when row-level `updated_at` disagrees**: device A has newer `updated_at` overall but device B has the newer per-field timestamp on the contested field. Assert B's value wins. (Locks in the `explicit-beats-fallback` rule already in `tsOf`.)
- **Attestation first-sign-wins under concurrent edits**: both devices edited fields after one of them signed. Merge: per-field merges normally, but every `ATTESTATION_FIELDS` entry comes from the signed side, even if the other side has a later `updated_at`. Then flip: both signed at different times → earlier signature wins, all attestation fields come from that side as a block (no field-level interleaving on attestation).
- **Tombstone-vs-edit child guard**: `shouldKeepEditedChild` returns true only when `child.updated_at > parentLastPulledAt`. Lock the boundary: equal timestamps → false; missing parentLastPulledAt → false; missing child.updated_at → false.

### Files touched

- `src/lib/__tests__/temp-uuid-child-rewrite.test.ts` (new — ~5 cases)
- `src/lib/__tests__/field-merge-concurrent-edit.test.ts` (new — ~6 cases)
- `src/lib/atomic-sync-manager.ts` (only if the rewrite helper isn't already exportable; minimal extract-and-export refactor with zero call-site behaviour change)

### Out of scope

- Any change to the sync pipeline's actual behaviour.
- The Realtime cross-device parent persistence gap and the temp-ID-adopts-existing-server-UUID overwrite — both still tracked separately as the audit noted.

