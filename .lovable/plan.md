
# Plan: Fix Mobile-to-Database Sync Failures

## Problem Analysis

Based on the console logs and code review, mobile devices are experiencing sync failures with the following evidence:

```
[Atomic Sync] IndexedDB timeout getting unsynced inspections
[Atomic Sync] IndexedDB timeout getting unsynced trainings
[Atomic Sync] IndexedDB timeout getting unsynced assessments
[Atomic Sync] Failed to sync daily assessment after retries: Item sync timeout
```

**Root Causes Identified:**

1. **Transaction Manager Executes Steps Sequentially**: The `executeTransaction` function processes database steps one-by-one (lines 30-72 in `transaction-manager.ts`). For inspections with many equipment items/systems, this creates dozens of sequential INSERT operations, each awaiting completion before the next starts.

2. **15-Second Per-Item Timeout Is Insufficient**: With sequential writes, an inspection with 20+ equipment items can easily exceed the 15-second `ITEM_SYNC_TIMEOUT` even on good connections.

3. **No Timeout Protection on Individual Transaction Steps**: Each Supabase insert in `executeTransaction` has no timeout, so a single slow insert blocks the entire transaction indefinitely.

4. **Rollback Data Fetching Adds Latency**: Before deletes, the system fetches all existing data for potential rollback (5 parallel fetches), adding network latency before actual sync begins.

---

## Solution: Batch Inserts + Step Timeouts

### 1. Modify Transaction Manager to Batch Related Data Inserts

**File:** `src/lib/transaction-manager.ts`

Instead of creating individual insert steps for each equipment/system/standard item, batch them into single bulk INSERT operations:

```typescript
// Current: Individual inserts (slow)
equipment.forEach(item => {
  steps.push({ table: 'inspection_equipment', operation: 'insert', data: item });
});

// Fixed: Single batch insert (fast)
if (equipment.length > 0) {
  steps.push({ table: 'inspection_equipment', operation: 'insert', data: equipment });
}
```

### 2. Add Per-Step Timeout in Transaction Manager

**File:** `src/lib/transaction-manager.ts`

Wrap each transaction step with a timeout to prevent any single database operation from blocking:

```typescript
const STEP_TIMEOUT = 5000; // 5 seconds per step

const stepWithTimeout = async (operation: Promise<any>) => {
  return Promise.race([
    operation,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Step timeout')), STEP_TIMEOUT))
  ]);
};
```

### 3. Batch Insert Steps in Atomic Sync Manager

**File:** `src/lib/atomic-sync-manager.ts`

Modify `syncInspectionAtomic`, `syncTrainingAtomic`, and `syncDailyAssessmentAtomic` to batch their inserts:

```typescript
// Current (creates N steps for N items):
if (systems.length > 0) {
  systems.forEach(system => {
    steps.push({ table: 'inspection_systems', operation: 'insert', data: system });
  });
}

// Fixed (creates 1 step for N items):
if (systems.length > 0) {
  steps.push({ table: 'inspection_systems', operation: 'insert', data: systems });
}
```

### 4. Extend Per-Item Sync Timeout

**File:** `src/lib/atomic-sync-manager.ts`

Increase `ITEM_SYNC_TIMEOUT` from 15 seconds to 25 seconds to accommodate network variability on mobile:

```typescript
const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (up from 15s)
```

---

## Implementation Details

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/transaction-manager.ts` | Add step timeout protection, handle batch inserts |
| `src/lib/atomic-sync-manager.ts` | Batch insert steps, extend timeout |
| `vite.config.ts` | Increment version to v2.1.50 |

### Transaction Manager Changes

**Add step timeout helper (after line 1):**
```typescript
const STEP_TIMEOUT = 5000; // 5 seconds per individual step

function withStepTimeout<T>(promise: Promise<T>, stepName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => {
      reject(new Error(`Step timeout: ${stepName}`));
    }, STEP_TIMEOUT))
  ]);
}
```

**Modify insert operation to handle arrays (line 41):**
```typescript
case 'insert':
  // Support both single item and batch insert
  result = await withStepTimeout(
    (supabase as any).from(step.table).insert(step.data),
    `insert:${step.table}`
  );
  break;
```

### Atomic Sync Manager Changes

**Convert individual inserts to batch inserts for inspections (lines 227-280):**
```typescript
// Batch all related data inserts
if (systems.length > 0) {
  steps.push({ table: 'inspection_systems', operation: 'insert', data: systems });
}
if (ziplines.length > 0) {
  steps.push({ table: 'inspection_ziplines', operation: 'insert', data: ziplines });
}
if (equipment.length > 0) {
  steps.push({ table: 'inspection_equipment', operation: 'insert', data: equipment });
}
if (standards.length > 0) {
  steps.push({ table: 'inspection_standards', operation: 'insert', data: standards });
}
if (summary) {
  steps.push({ table: 'inspection_summary', operation: 'insert', data: [sanitizedSummary] });
}
```

Same pattern applied to:
- `syncTrainingAtomic` (lines 615-670)
- `syncDailyAssessmentAtomic` (lines 1014-1073)

---

## VersionBadge Verification

**Status:** ✅ Correctly Implemented

The `VersionBadge` component is correctly placed in the Dashboard's user dropdown menu:

**Location:** `src/pages/Dashboard.tsx`, lines 833-836
```tsx
<DropdownMenuItem onClick={() => setContactSheetOpen(true)}>
  <MessageCircle className="w-4 h-4 mr-2" />
  Contact Developer
</DropdownMenuItem>

{/* Version Badge - Below Contact Developer */}
<div className="px-2 py-1.5">
  <VersionBadge compact />
</div>

<DropdownMenuSeparator />
```

- Position: ✅ Below "Contact Developer"
- Position: ✅ Above the separator
- Compact prop: ✅ Applied (`compact`)
- Version source: ✅ Uses `APP_VERSION` from `vite.config.ts` (currently `v2.1.40`)

---

## Performance Impact

| Before | After |
|--------|-------|
| 20 equipment items = 20 sequential INSERTs | 20 equipment items = 1 batch INSERT |
| ~20+ seconds for large inspections | ~3-5 seconds for large inspections |
| Frequent timeout failures on mobile | Reliable sync under 25s timeout |

---

## Version Update

Increment to `v2.1.50` in `vite.config.ts`:
```typescript
// v2.1.50 - Mobile sync fix: batch inserts for faster sync, step-level timeouts, extended per-item timeout
const APP_VERSION = "2.1.50";
```

---

## Testing Checklist

After implementation, verify:
- [ ] Mobile devices sync inspections with many equipment items without timeout
- [ ] Daily assessments sync correctly on mobile
- [ ] Training reports sync correctly on mobile
- [ ] Dashboard shows synced data on web after mobile edit
- [ ] Version badge shows v2.1.50 in dropdown menu
- [ ] No regression in desktop sync performance
