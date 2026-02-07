

# Fix Plan: Equipment Quantity Data Loss - v2.4.5

## Root Cause

The `EquipmentTable` component uses **object reference equality** (`eq === item`) to locate which equipment item to update. This silently drops edits when the `equipment` array is replaced with new object references -- which happens when:

1. The Supabase fetch completes after offline data was already loaded (lines 888-894 in InspectionForm)
2. Auto-save replaces temp IDs with real UUIDs (lines 1216-1223)
3. Another EquipmentTable category triggers a state update

When `eq === item` matches nothing, the `.map()` returns the array unchanged and the user's input is silently discarded.

### Why Other Tables Are Not Affected

- **OperatingSystemsTable**: Uses index-based updates (`updateSystem(index, field, value)`)
- **ZiplinesTable**: Uses index-based updates (`updateZipline(index, field, value)`)
- **EquipmentTable**: Uses reference equality -- the only table with this bug

### The Same Bug Exists in Delete

`handleDeleteConfirm` also uses `eq !== itemToDelete.item` (reference equality), meaning deletes can also silently fail under the same race conditions.

---

## Solution

Replace reference equality with **ID-based matching** in both `updateEquipment` and `handleDeleteConfirm` inside `EquipmentTable.tsx`. This is immune to object reference changes.

### File: `src/components/inspection/EquipmentTable.tsx`

**Change 1: Fix `updateEquipment` (line 92-97)**

Before:
```typescript
const updateEquipment = useCallback((item: any, field: string, value: any) => {
  const updated = equipment.map((eq) =>
    eq === item ? { ...eq, [field]: value } : eq
  );
  onUpdate(updated);
}, [equipment, onUpdate]);
```

After:
```typescript
const updateEquipment = useCallback((item: any, field: string, value: any) => {
  const updated = equipment.map((eq) =>
    eq.id === item.id ? { ...eq, [field]: value } : eq
  );
  onUpdate(updated);
}, [equipment, onUpdate]);
```

**Change 2: Fix `handleDeleteConfirm` (line 99-106)**

Before:
```typescript
const handleDeleteConfirm = useCallback(() => {
  if (itemToDelete) {
    const updated = equipment.filter((eq) => eq !== itemToDelete.item);
    onUpdate(updated);
    onImmediateSave?.();
    setItemToDelete(null);
  }
}, [itemToDelete, equipment, onUpdate, onImmediateSave]);
```

After:
```typescript
const handleDeleteConfirm = useCallback(() => {
  if (itemToDelete) {
    const updated = equipment.filter((eq) => eq.id !== itemToDelete.item.id);
    onUpdate(updated);
    onImmediateSave?.();
    setItemToDelete(null);
  }
}, [itemToDelete, equipment, onUpdate, onImmediateSave]);
```

### Version Bump

Update `vite.config.ts` to **v2.4.5**.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/components/inspection/EquipmentTable.tsx` | Update | Replace `===` reference equality with `.id` matching in update and delete |
| `vite.config.ts` | Update | Bump to v2.4.5 |

---

## Why This Is a Client-Side Bug (Not RLS/Backend)

- The data never reaches the save function because `eq === item` silently produces an unchanged array
- The Supabase upsert correctly persists whatever state it receives -- it just receives stale data
- RLS policies are not involved since the data loss occurs before any network call

---

## Expected Outcome

1. Equipment quantities, production years, comments, and results will persist correctly across tab switches
2. Deleting equipment items will work reliably even after Supabase data refresh
3. All equipment categories (harnesses, helmets, lanyards, etc.) are fixed since they all share the same component
4. Fix applies to all users, all platforms (web and mobile), all report types using EquipmentTable

---

## Testing Checklist

- [ ] Add equipment, enter quantity, switch to another tab, return -- quantity persists
- [ ] Enter production year, switch tabs and return -- year persists
- [ ] Delete an equipment item after switching tabs -- deletion works
- [ ] Add equipment while offline, verify data persists when coming back online
- [ ] Verify all 8 equipment categories retain data correctly

