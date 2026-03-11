

## UUID Ordering Gap Analysis — Report

### Status: 1 GAP FOUND

---

### What's Stable (No Gaps)

**Inspection forms** — Fully deterministic. `display_order` is stamped from array index on every save (line 1518: `systems.map((s, i) => ({ ...s, display_order: i }))`). All retrieval paths sort by `display_order`: `getRelatedDataOffline`, server queries, edge functions. UUIDs are never used for ordering.

**Training forms** — Stable. Components stamp `created_at: new Date().toISOString()` on every new item (training `OperatingSystemsSection` line 47, 60). Both IndexedDB reads (`getTrainingDataOffline`) and server queries sort by `created_at`. Since each item gets a unique timestamp at creation time, order is preserved across all state transitions.

**Photo galleries** — Stable. Uses explicit `display_order` column, persisted on drag-end and sorted on load.

---

### GAP: Daily Assessment Components Do Not Stamp `created_at`

**Severity: Medium — causes random reordering of custom "Other" entries after save/reload**

All 6 daily assessment child components create items **without** a `created_at` field:

| Component | Creates items without `created_at` |
|---|---|
| `OperatingSystemsSection.tsx` (daily) | Lines 40-43, 50-54 |
| `BeginningOfDaySection.tsx` | Lines 37-40, 57-60 |
| `EndOfDaySection.tsx` | Lines 37-39, 57-59 |
| `EquipmentChecksSection.tsx` | Lines 36-39 |
| `StructureChecksSection.tsx` | Lines 40-42 |
| `EnvironmentChecksSection.tsx` | Lines 36-38 |

**Why this breaks ordering:**

1. User creates items → stored in React state (ordered by insertion) → saved to IndexedDB without `created_at`
2. On reload, `getAssessmentDataOffline` sorts by `created_at` (line 1477): `new Date(a.created_at || 0).getTime()`
3. All items have `created_at = null` → all sort to `new Date(0)` → **order is determined by IndexedDB key enumeration**, which is UUID-alphabetical, not insertion order
4. On server save, the DB auto-sets `created_at = now()` via column default, but all items in a single upsert batch get the **same timestamp** → order is again non-deterministic on reload

**Contrast with training:** The training `OperatingSystemsSection` (line 47) stamps `created_at: new Date().toISOString()` at creation — daily assessment does not.

### Proposed Fix

Add `created_at: new Date().toISOString()` to every item creation call in all 6 daily assessment components. This is a one-line addition per creation site (~10 sites total), matching the pattern already used in the training components.

**Files to change:**
- `src/components/daily-assessment/OperatingSystemsSection.tsx` — 2 sites
- `src/components/daily-assessment/BeginningOfDaySection.tsx` — 2 sites
- `src/components/daily-assessment/EndOfDaySection.tsx` — 2 sites
- `src/components/daily-assessment/EquipmentChecksSection.tsx` — 1 site
- `src/components/daily-assessment/StructureChecksSection.tsx` — 1 site
- `src/components/daily-assessment/EnvironmentChecksSection.tsx` — 1 site

No database migration needed. No changes to save handlers or retrieval logic — the sort-by-`created_at` path already exists and will work correctly once the field is populated.

