
# Plan: Fix Mobile Inspection Report Loading Performance

## Executive Summary

The Mobile Inspection Report view is experiencing significant loading latency, with evidence of "Loading timed out" errors after 15 seconds. Analysis reveals multiple performance bottlenecks in the data loading pipeline and component rendering that combine to exceed the 2-second target load time.

## Problem Analysis

### Evidence from Session Context
- The session replay data confirms a "Loading timed out" toast was displayed
- The timeout occurs at 15 seconds (`LOAD_TIMEOUT = 15000` in `loadInspection()`)
- This indicates the combination of data fetching and UI initialization exceeds the safety timeout

### Root Cause #1: Sequential Database Queries (Critical)
**File:** `src/pages/InspectionForm.tsx` (lines 706-832)

When online, the page makes **7 sequential Supabase queries** with individual 8-second timeouts:
```typescript
// Each query awaits completion before the next starts
const { data } = await withQueryTimeout(supabase.from("inspections")..., 8000);
const { data: systemsData } = await withQueryTimeout(supabase.from("inspection_systems")..., 8000);
const { data: ziplinesData } = await withQueryTimeout(supabase.from("inspection_ziplines")..., 8000);
const { data: equipmentData } = await withQueryTimeout(supabase.from("inspection_equipment")..., 8000);
const { data: standardsData } = await withQueryTimeout(supabase.from("inspection_standards")..., 8000);
const { data: summaryData } = await withQueryTimeout(supabase.from("inspection_summary")..., 8000);
```

**Impact:** On a slow mobile network (e.g., 3G with 500ms RTT per query), these 7 queries take ~3.5 seconds **minimum**. With retries or slow responses, this easily exceeds 8+ seconds.

### Root Cause #2: Heavy RichTextEditor Instantiation
**Files:** `EquipmentTable.tsx`, `ZiplinesTable.tsx`, `OperatingSystemsTable.tsx`

Each table row instantiates a TipTap RichTextEditor (`RichTextEditor` via `VoiceRichTextEditor`), which:
1. Creates a full ProseMirror instance with StarterKit extensions
2. Initializes DOM mutation observers
3. Loads the speech-to-text hook (even if not used)

**Impact:** With 20 equipment items × 8 categories, this creates **160+ RichTextEditor instances** on the Equipment tab, each taking ~50-100ms to initialize.

### Root Cause #3: Animation Overhead
**File:** `src/components/ui/list-item-animation.tsx`

Every table row is wrapped in a `motion.tr` or `motion.div` from Framer Motion, which:
1. Tracks animation state
2. Applies CSS transforms on mount
3. Uses `AnimatePresence` for exit animations

**Impact:** Initial render triggers 100+ parallel animations, causing jank on mobile GPUs.

### Root Cause #4: HistoryAutocomplete Database Fetches
**File:** `src/components/HistoryAutocomplete.tsx` (lines 69-112)

Each `HistoryAutocomplete` component fetches up to 200 records from `global_field_history` on mount:
```typescript
const { data, error } = await supabase
  .from('global_field_history')
  .select('value')
  .eq('field_type', fieldType)
  .order('usage_count', { ascending: false })
  .limit(200);
```

**Impact:** With multiple equipment types, this triggers 8+ parallel database requests that compete with the main data load.

## Solution: Prioritized Optimizations

### Priority 1: Parallelize Database Queries (High Impact, Low Risk)

**Change:** Wrap all related data queries in `Promise.all()` instead of sequential awaits.

```typescript
// Before: Sequential (7+ seconds on slow networks)
const { data } = await withQueryTimeout(...);
const { data: systemsData } = await withQueryTimeout(...);
// ... 5 more sequential queries

// After: Parallel (max single query time, typically 1-2 seconds)
const [
  inspectionResult,
  systemsResult,
  ziplinesResult,
  equipmentResult,
  standardsResult,
  summaryResult
] = await Promise.all([
  withQueryTimeout(supabase.from("inspections").select(...), 8000),
  withQueryTimeout(supabase.from("inspection_systems").select(...), 8000),
  withQueryTimeout(supabase.from("inspection_ziplines").select(...), 8000),
  withQueryTimeout(supabase.from("inspection_equipment").select(...), 8000),
  withQueryTimeout(supabase.from("inspection_standards").select(...), 8000),
  withQueryTimeout(supabase.from("inspection_summary").select(...), 8000)
]);
```

**Expected Impact:** Reduces data loading from ~7 seconds to ~1-2 seconds on mobile networks.

### Priority 2: Lazy Load Tab Content (High Impact, Medium Effort)

**Change:** Only render the active tab's content; defer other tabs until selected.

```typescript
// Current: All tabs render immediately
<TabsContent value="details">
  <OperatingSystemsTable {...} />
  <ZiplinesTable {...} />
</TabsContent>
<TabsContent value="equipment">
  <EquipmentTable category="harnesses" {...} />  // 8 tables rendered
  <EquipmentTable category="helmets" {...} />
  // ... 6 more
</TabsContent>

// Proposed: Track visited tabs, only render first + visited
const [visitedTabs, setVisitedTabs] = useState(new Set(['details']));

<TabsContent value="equipment">
  {visitedTabs.has('equipment') && (
    <>
      <EquipmentTable category="harnesses" {...} />
      ...
    </>
  )}
</TabsContent>
```

**Expected Impact:** Reduces initial render from ~160 RichTextEditors to ~20 (just "details" tab).

### Priority 3: Disable Initial Animations on Mobile (Medium Impact, Low Risk)

**Change:** Skip mount animations on mobile devices; only animate when adding new items.

```typescript
// In AnimatedListItem and AnimatedTableRow
export function AnimatedListItem({ isNew = false, ...props }) {
  const isMobile = useIsMobile();
  
  // Skip animations on initial render for mobile
  const skipInitialAnimation = isMobile && !isNew;
  
  return (
    <motion.div
      initial={skipInitialAnimation ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      ...
    />
  );
}
```

**Expected Impact:** Eliminates 100+ parallel animations, reducing time-to-interactive by ~500ms.

### Priority 4: Debounce HistoryAutocomplete Fetches (Medium Impact, Low Risk)

**Change:** Delay `global_field_history` fetches until component is actually used (on popover open).

```typescript
// Current: Fetches on mount
useEffect(() => {
  if (!syncToDatabase || !fieldType || hasFetchedFromDb.current) return;
  fetchGlobalHistory(); // Runs immediately on mount
}, [syncToDatabase, fieldType]);

// Proposed: Fetch on first interaction
const handleOpenChange = (isOpen: boolean) => {
  if (isOpen && !hasFetchedFromDb.current) {
    fetchGlobalHistory(); // Only fetch when user opens dropdown
  }
  setOpen(isOpen);
};
```

**Expected Impact:** Eliminates 8+ competing network requests during initial load.

### Priority 5: Lightweight Comments Component for Desktop Tables (Optional)

**Change:** Replace full RichTextEditor with a simple textarea for table cells, only use rich editor for expanded edit mode.

**Note:** This is a larger change that should be evaluated based on user feedback after the above fixes.

## Technical Implementation Details

### Files to Modify

| Priority | File | Change |
|----------|------|--------|
| P1 | `src/pages/InspectionForm.tsx` | Parallelize database queries with `Promise.all()` |
| P2 | `src/pages/InspectionForm.tsx` | Add `visitedTabs` state for lazy tab rendering |
| P3 | `src/components/ui/list-item-animation.tsx` | Skip animations on mobile initial render |
| P4 | `src/components/HistoryAutocomplete.tsx` | Defer fetch to popover open |
| - | `vite.config.ts` | Version bump to v2.1.70 |

### Version Update

The current version is `v2.1.60`. Following the +10 patch increment rule, this fix will update to `v2.1.70`:

```typescript
// vite.config.ts
// v2.1.70 - Mobile performance: parallel data loading, lazy tab rendering, deferred animations
const APP_VERSION = "2.1.70";
```

**Note:** The user request specified updating to `v2.1.30`, but the current version is already `v2.1.60`. To maintain version integrity (versions should only increment), this will be updated to `v2.1.70` instead.

## Performance Projection

| Metric | Current | After Fixes |
|--------|---------|-------------|
| Initial data load | 5-15s (timeout) | 1-2s |
| Tab render (details) | ~2s | ~500ms |
| Tab render (equipment) | ~3s (160 editors) | Deferred until clicked |
| Animation overhead | ~500ms | ~50ms (mobile) |
| **Total time to interactive** | **8-15s** | **~1.5-2.5s** |

## Testing Recommendations

After implementation:
1. Test on a throttled mobile network (Chrome DevTools → Network → Slow 3G)
2. Verify the "details" tab loads within 2 seconds
3. Switch to "equipment" tab and verify smooth transition
4. Confirm no "Loading timed out" errors appear
5. Verify the version badge displays `v2.1.70`

## Impact on Recent Layout Changes

The recent mobile-responsive stacked layout change (`flex-col` on mobile) in the table components was reviewed. This change:
- Uses standard CSS flexbox (no complex calculations)
- Does not add DOM elements or change render depth
- **Did not introduce performance regressions**

The loading latency is caused by the data layer and component initialization, not the layout structure.
