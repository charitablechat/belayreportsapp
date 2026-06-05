## Quick answer on the Lovable incident email

Unrelated. That incident is about file uploads inside the Lovable build editor (attaching images/PDFs to the AI chat). It does not affect deployed app data, IndexedDB, or Supabase writes. Luke's "Climbing Wall / Automated Safety disappears" is a separate, app-side regression from yesterday's tombstone-load hotfix.

## Root cause

Yesterday's Lakeview hotfix added a persistent `inspection_operating_system` tombstone in `OperatingSystemsTable.handleDeleteConfirm` and a load-time filter (`applySystemsTombstone`) anchored to either server id OR a `businessKey = lower(name) + "|" + lower(system_name)`.

When Luke deleted the prior "Climbing Wall / Automated Safety" row, a tombstone was written with businessKey `climbing wall|automated safety` (60-day TTL). When he now re-adds a new row and types the same name+system_name, the new row's derived businessKey matches the tombstone, so on reload `applySystemsTombstone` filters it out. The save itself succeeds — the row exists in IDB and Supabase — it just gets filtered out on every subsequent load.

Same mechanism explains any other Operating-Systems row Luke ever deletes-then-recreates with the same name+system pair. Dividers are not affected (no businessKey; tombstoned by id only — new divider gets a fresh id).

## Fix

Narrow, shared-path fix in `src/components/inspection/OperatingSystemsTable.tsx`: when the user edits `name` or `system_name`, compute the resulting businessKey and call `clearChildTombstone("inspection_operating_system", effectiveInspectionId, { businessKey })`. This makes "re-add with the same name" lift the prior tombstone immediately, before the next save/reload.

Also clear by row id on edit (covers the case where a server-id row is somehow tombstoned and the user is editing it back into existence — defensive, cheap).

`clearChildTombstone` already exists and is no-op-safe when no matching tombstone is present, so this is a one-call addition with no behavioral risk to the unaffected paths.

### Code change (single file)

In `updateSystem` in `OperatingSystemsTable.tsx`, after the `onUpdate` call, when `field === "name" || field === "system_name"`:

```ts
const merged = { ...item, [field]: value };
const bk = osBusinessKey(merged); // reuse shared helper from inspectionLoader
if (effectiveInspectionId) {
  if (bk) {
    clearChildTombstone("inspection_operating_system", effectiveInspectionId, { businessKey: bk });
  }
  if (item.id && !String(item.id).startsWith("temp-")) {
    clearChildTombstone("inspection_operating_system", effectiveInspectionId, { id: item.id });
  }
}
```

Import `clearChildTombstone` alongside the existing `addChildTombstone`, and import `osBusinessKey` from `@/lib/form-loaders/inspectionLoader` (already exported there per cross-platform shared-path rule).

No change to delete logic, no change to load filters, no change to other tables.

## Tests

1. New unit test `src/components/inspection/__tests__/operating-systems-recreate-clears-tombstone.test.ts`:
   - Seed a tombstone for businessKey `climbing wall|automated safety`.
   - Simulate `updateSystem` editing a fresh temp row's `name` to "Climbing Wall" then `system_name` to "Automated Safety".
   - Assert `isChildTombstoned(...)` is false after the second edit.
   - Assert `applySystemsTombstone(reportId, [{id:"temp-x", name:"Climbing Wall", system_name:"Automated Safety"}])` returns the row (not filtered).

2. Existing `inspection-form-systems-tombstone-load.test.ts` and `operating-systems-resurrection.test.ts` must still pass (delete-without-recreate behavior unchanged).

3. Run focused tests then full suite:
   ```bash
   bunx vitest run \
     src/components/inspection/__tests__/operating-systems-recreate-clears-tombstone.test.ts \
     src/pages/__tests__/inspection-form-systems-tombstone-load.test.ts \
     src/lib/__tests__/operating-systems-resurrection.test.ts
   bunx vitest run
   ```

## Cross-platform impact

- All platforms (web, PWA, iPad, desktop, mobile) render Operating Systems through the same `OperatingSystemsTable.tsx` component and load through the same `inspectionLoader.ts` + `child-row-tombstones.ts`. Single-file edit covers every device path.
- No platform-specific branches introduced.

## Production cleanup (Luke's Lakeview report only — NOT in this hotfix)

After deploy, Luke can clear the Lakeview report's stale tombstone bucket from his browser by recreating the row (the fix will lift it automatically on first edit). No DML or per-report cleanup needed; the code change is self-healing.

If you would like a one-time `localStorage.removeItem('rw_child_tombstones_v1:inspection_operating_system:c575d3d9-68a4-43f4-a6e5-e4268338e465')` instruction sent to Luke for instant relief before the new build reaches him, say the word and I'll include it in the release note — but it's optional given the auto-heal behavior.

## Out of scope / monitored

- Contact-field save issue remains on monitored follow-up.
- No backend / RLS / edge-function changes.
- No change to deletion tombstone semantics or TTL.
