

## Verification: Ziplines & Operating Systems Ordering Persistence

### Result: All 8 layers are correctly covered

The ordering pipeline is sound across all persistence and retrieval paths. Here is the layer-by-layer verification:

| # | Layer | Stamps `display_order`? | Reads by `display_order`? | Status |
|---|-------|------------------------|--------------------------|--------|
| 1 | **New item creation** (ZiplinesTable, OperatingSystemsTable) | No — items get no `display_order` field initially | N/A — order is implicit in array position | OK (stamped at save) |
| 2 | **Offline save** (InspectionForm ~line 1410) | Yes — `ziplines.map((z, i) => ({ ...z, display_order: i }))` | N/A | OK (fixed in prior change) |
| 3 | **Offline read** (getRelatedDataOffline, offline-storage.ts line 1162) | N/A | Yes — `.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))` | OK |
| 4 | **Online save** (InspectionForm ~line 1518) | Yes — `ziplines.map((z, i) => ({ ...z, display_order: i }))` | N/A | OK |
| 5 | **Online load** (InspectionForm ~line 1036-1039) | N/A | Yes — `.order("display_order")` on server query | OK |
| 6 | **Server → IndexedDB cache** (InspectionForm ~line 1159) | Preserved — server data already has `display_order` from DB column | N/A | OK |
| 7 | **Atomic Sync Manager** (~line 163-165) | Reads from IndexedDB via `getRelatedDataOffline` which sorts by `display_order`; upserts data as-is (with `display_order` field intact) | Yes | OK |
| 8 | **Report generation** (edge functions) | N/A | Yes — `.order("display_order")` | OK |

### Local-is-newer guard (line 1084)

When `isLocalDataNewer` returns `true`, server child data is **skipped entirely** — local IndexedDB state (which has `display_order` stamped) is preserved. No stale server data overwrites the order.

### Drag-and-drop reorder flow

1. User drags item → `useNativeDrag` reorders the React state array
2. `onUpdate(reordered)` sets the new array order in React state
3. Auto-save (or manual save) triggers → offline save path stamps `display_order: i` from new array index
4. Background sync picks up the stamped order from IndexedDB → upserts to server with correct `display_order`

### Conclusion

**No changes needed.** The recent fix (stamping `display_order` in the offline save path) closed the last gap. All paths now correctly persist and respect user-defined ordering for ziplines, operating systems, and equipment.

