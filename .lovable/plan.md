
# Plan: Fix Mobile Auto-Save Item Reordering Issue

## Problem Summary
On mobile viewport (<768px), when a new item is added to the Inspection Report (Systems, Equipment, or Ziplines), the auto-save mechanism causes:
1. **Input interruption** - the save operation blocks user input
2. **UI focus loss** - input fields lose focus during save
3. **Item reordering** - newly added items at position 0 get moved to the bottom of the list after save

## Root Cause Analysis

The issue is in `InspectionForm.tsx` lines 1001-1037. When new items are inserted into the database, the `setSystems`, `setZiplines`, and `setEquipment` state updates use a pattern that **reorders items incorrectly**:

```typescript
// Current problematic code (line 1002-1005):
setSystems(prev => {
  const existingIds = new Set(prev.filter(s => s.id && !s.id.startsWith('temp-')).map(s => s.id));
  return [...prev.filter(s => existingIds.has(s.id)), ...newSystems];
});
```

**Problem breakdown:**
1. User adds new item → prepended at index 0 with `temp-{uuid}` ID
2. 1.5-second debounce triggers auto-save
3. Save replaces `temp-{uuid}` with real UUID and calls `setSystems()`
4. The state update filters out the temp item, then **appends** new items at the end
5. This moves the newly-added item from position 0 to the end of the list
6. UI re-renders, causing focus loss and visual jump

---

## Solution

### Strategy: Preserve Item Order with Position-Aware ID Replacement

Instead of filtering and appending (which destroys order), we should **replace temp IDs in-place** to preserve the user's intended order.

---

## Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `src/pages/InspectionForm.tsx` | **P0** | Fix state update logic to preserve item order during ID replacement |

---

## Technical Changes

### InspectionForm.tsx - Fix State Update for New Items

Replace the problematic state update pattern with position-preserving logic:

**Current (Broken) - Lines 1001-1006:**
```typescript
if (newSystems.length > 0) {
  parallelOperations.push(
    dbOp(supabase.from("inspection_systems").insert(newSystems))
  );
  setSystems(prev => {
    const existingIds = new Set(prev.filter(s => s.id && !s.id.startsWith('temp-')).map(s => s.id));
    return [...prev.filter(s => existingIds.has(s.id)), ...newSystems];
  });
}
```

**Fixed (Position-Preserving):**
```typescript
if (newSystems.length > 0) {
  // Create a map from temp ID to new permanent ID
  const tempToNewIdMap = new Map<string, typeof newSystems[0]>();
  validSystems.filter(s => !s.id || s.id.startsWith('temp-')).forEach((original, i) => {
    if (newSystems[i]) {
      tempToNewIdMap.set(original.id || '', newSystems[i]);
    }
  });
  
  parallelOperations.push(
    dbOp(supabase.from("inspection_systems").insert(newSystems))
  );
  
  // Replace temp items in-place, preserving position
  setSystems(prev => prev.map(s => {
    if (s.id && s.id.startsWith('temp-') && tempToNewIdMap.has(s.id)) {
      return tempToNewIdMap.get(s.id)!;
    }
    return s;
  }));
}
```

Apply the same fix to:
- **Ziplines** (lines 1014-1022)
- **Equipment** (lines 1030-1038)

---

## Alternative: Simplify by Removing In-Save State Updates

A simpler approach is to **not update state at all** during the database sync. The temp ID is already functional for UI purposes, and we can replace it silently without triggering a re-render:

```typescript
if (newSystems.length > 0) {
  parallelOperations.push(
    dbOp(supabase.from("inspection_systems").insert(newSystems))
  );
  // Don't call setSystems() here at all
  // The next save or page load will use the correct IDs
}
```

This approach:
- Eliminates re-renders during save (no focus loss)
- Preserves item order (no state manipulation)
- Temp IDs work fine for editing (they're just local identifiers)
- Real IDs get loaded on next page load or sync

---

## Recommended Approach: Hybrid (Option 2 with Deferred Replacement)

1. **Remove immediate state updates** during save (stops reordering/focus loss)
2. **Use a ref to track ID mappings** for persistence across saves
3. **Replace temp IDs only on successful remote sync completion** using the same deferred, non-blocking pattern

This aligns with the "Immediate, Irreversible Persistence" architecture and "Non-Blocking Persistence" patterns already established.

---

## Implementation Details

### Changes to performSave() function

**Remove these problematic state updates (lines 1001-1038):**
```typescript
// DELETE these setSystems/setZiplines/setEquipment calls inside the sync block
setSystems(prev => {
  const existingIds = new Set(prev.filter(s => s.id && !s.id.startsWith('temp-')).map(s => s.id));
  return [...prev.filter(s => existingIds.has(s.id)), ...newSystems];
});
```

**Add deferred ID replacement after sync completes (around line 1059):**
```typescript
// After successful sync, quietly update temp IDs without triggering re-render flicker
// This uses functional updates that preserve order
const replaceIdsAfterSync = () => {
  // Build ID replacement maps (temp ID -> permanent ID)
  const systemIdMap = new Map<string, string>();
  validSystems.filter(s => !s.id || s.id.startsWith('temp-')).forEach((orig, i) => {
    if (newSystems[i]) systemIdMap.set(orig.id || '', newSystems[i].id);
  });
  
  // Same for ziplines and equipment...
  
  // Only update if there are replacements to make
  if (systemIdMap.size > 0) {
    setSystems(prev => prev.map(s => 
      systemIdMap.has(s.id) ? { ...s, id: systemIdMap.get(s.id)! } : s
    ));
  }
};

// Run deferred to not block UI
setTimeout(replaceIdsAfterSync, 100);
```

---

## Benefits

| Before | After |
|--------|-------|
| New items jump to bottom on save | Items stay at position 0 |
| Focus lost during auto-save | No focus interruption |
| State updates during sync cause flicker | Deferred, non-blocking updates |
| Input feels sluggish on mobile | Smooth, responsive input |

---

## Testing Checklist

After implementation:
- [ ] Add new System on mobile → stays at top after auto-save
- [ ] Add new Equipment on mobile → stays at top after auto-save  
- [ ] Add new Zipline on mobile → stays at top after auto-save
- [ ] Type in new item field → focus not lost during auto-save
- [ ] Verify items persist correctly after page reload
- [ ] Test desktop behavior unchanged
