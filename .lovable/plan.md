

## Inspection Ordering: Gap Found in Offline Save Path

### Current State

**Online save path (works correctly):**
- `InspectionForm.tsx` line 1517-1519 stamps `display_order: i` from array index before upserting to the server
- Server queries and edge functions sort by `display_order` — correct

**Offline save path (GAP):**
- `saveRelatedDataOffline('systems', id!, systems)` at line 1405 saves the React state array **without** stamping `display_order`
- New items created in `OperatingSystemsTable`, `ZiplinesTable`, and `EquipmentTable` have **no `display_order` field**
- `getRelatedDataOffline` (line 1162) sorts by `display_order ?? 0` — all items without it collapse to position 0, making order non-deterministic
- The `atomic-sync-manager` reads from IndexedDB and upserts to server **without** re-stamping `display_order`

**Failure scenario:**
1. User adds 3 systems offline → state is `[A, B, C]` with no `display_order`
2. Auto-save writes to IndexedDB without `display_order`
3. User closes form, reopens → `getRelatedDataOffline` sorts by `display_order ?? 0` → all items tied at 0 → order depends on IndexedDB key enumeration (UUID-alphabetical)
4. Background sync pushes to server without `display_order` → server has no ordering info

### Proposed Fix

Stamp `display_order` from array index **at the offline save site** in `InspectionForm.tsx`. This is the single choke-point where all data flows through before hitting IndexedDB.

**File: `src/pages/InspectionForm.tsx`** — In the offline save block (~line 1404-1417), stamp `display_order` before calling `saveRelatedDataOffline`:

```ts
// Before:
childSaveOps.push(saveRelatedDataOffline('systems', id!, systems));

// After:
childSaveOps.push(saveRelatedDataOffline('systems', id!, systems.map((s, i) => ({ ...s, display_order: i }))));
```

Same for ziplines and equipment (3 lines changed total).

This ensures:
- IndexedDB always has `display_order` stamped → offline reads return correct order
- `atomic-sync-manager` picks up the stamped `display_order` from IndexedDB → server gets correct order
- No changes needed to edge functions, retrieval logic, or components
- Drag-and-drop reordering already updates the array order in React state, so stamping from index captures the new order

No database migration needed. No component changes needed.

