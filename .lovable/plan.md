

# Fix: Equipment Quantity Data Loss (Stale Closure Bug)

## Problem

All 8 `EquipmentTable` components share one `equipment` state array via `setEquipment`. Each component captures `equipment` in its `useCallback` closure. Because the component is wrapped in `React.memo()`, when one table updates `equipment`, the other 7 tables still hold the **old** `equipment` reference until React re-renders them.

Any operation (edit, add, delete) in a second table before the re-render completes will derive its new array from the **stale** prop, silently dropping the first table's changes. This is why quantities disappear -- the upsert sends `quantity: null` from the stale array, overwriting what you entered.

## Root Cause (Technical)

In `src/components/inspection/EquipmentTable.tsx`, lines 75-106, three callbacks read `equipment` directly from the prop closure:

```text
updateEquipment:  equipment.map(eq => ...)      -- line 93
addEquipment:     [...equipment]                 -- line 87
handleDeleteConfirm: equipment.filter(eq => ...) -- line 101
```

Since `onUpdate` is `setEquipment` (a React state setter), it accepts **functional updates** (`prev => newValue`), which always receive the latest committed state -- not a stale closure.

## Fix

**File: `src/components/inspection/EquipmentTable.tsx`**

Convert all three callbacks to use functional state updates:

### 1. `addEquipment` (line 75-89)
Change from `onUpdate([newItem, ...equipment])` to `onUpdate(prev => [newItem, ...prev])`. Remove `equipment` from the dependency array.

### 2. `updateEquipment` (line 92-97)
Change from `onUpdate(equipment.map(...))` to `onUpdate(prev => prev.map(...))`. Remove `equipment` from the dependency array, keeping only `[onUpdate]`.

### 3. `handleDeleteConfirm` (line 99-106)
Change from `onUpdate(equipment.filter(...))` to `onUpdate(prev => prev.filter(...))`. Remove `equipment` from the dependency array.

## Why This Fixes It

With functional updates, each state mutation reads from `prev` (the latest committed state), not from a potentially stale prop reference. Even if 8 tables fire updates in rapid succession, no data is lost -- each update stacks correctly on top of the previous one.

## Impact
- Zero risk to other functionality -- `setEquipment` already accepts functional updaters natively
- Improves performance by reducing `useCallback` dependency arrays (fewer re-creations)
- Fixes data loss for **all** equipment fields (quantity, production year, comments, type, result), not just quantity

