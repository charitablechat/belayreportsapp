

## Fully Offline GlobalAutocomplete via IndexedDB

### Current State
- GlobalAutocomplete uses `localStorage` as offline fallback — stores only flat string arrays, losing `usage_count` and `id`
- Online: fetches from `global_field_history` table, fire-and-forget upserts
- Module-level in-memory cache (`_globalHistoryCache`) for cross-instance sharing
- No pending-sync queue for entries created while offline

### Plan

#### 1. Add `autocomplete_history` store to IndexedDB (v9 upgrade)

**File: `src/lib/offline-storage.ts`**
- Bump `DB_VERSION` from 8 → 9
- Add new store to `InspectionDB` schema interface:
  ```
  autocomplete_history: {
    key: string;  // compound: `${field_type}::${value}`
    value: { field_type, value, usage_count, last_used_at, synced }
  }
  ```
- Add index `by-field-type` on `field_type` for efficient per-field queries
- Add index `by-synced` on `synced` for pending sync detection
- Export CRUD helpers: `getAutocompleteHistory(fieldType)`, `putAutocompleteEntry(entry)`, `deleteAutocompleteEntry(key)`, `getUnsyncedAutocompleteEntries()`

#### 2. Refactor GlobalAutocomplete to use IndexedDB-first

**File: `src/components/GlobalAutocomplete.tsx`**
- Replace localStorage reads/writes with IndexedDB helpers from offline-storage
- On mount: load from IndexedDB (instant), then background-fetch from database when online
- On save: write to IndexedDB immediately (with `synced: false`), then fire-and-forget upsert to database; on success mark `synced: true`
- On delete: remove from IndexedDB, then fire-and-forget delete from database
- Keep module-level in-memory cache for instant cross-instance access
- Remove all `localStorage.getItem/setItem` calls for this feature

#### 3. Background sync for offline-created entries

**File: `src/components/GlobalAutocomplete.tsx`**
- On `fetchGlobalHistory` (when online): also push any `synced: false` entries to the database
- Simple: iterate unsynced entries, upsert each, mark synced on success
- No new sync infrastructure needed — piggybacks on existing fetch cycle

#### 4. Migration: localStorage → IndexedDB

**File: `src/components/GlobalAutocomplete.tsx`**
- On first IndexedDB load per field type: check if localStorage key exists, migrate entries to IndexedDB, then delete the localStorage key
- One-time, transparent to the user

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Add `autocomplete_history` store (v9), schema types, CRUD helpers |
| `src/components/GlobalAutocomplete.tsx` | Replace localStorage with IndexedDB helpers, add offline sync |

### No UI Changes Needed
The component already handles loading states, instant local-state updates, and responsive layout. The change is purely in the persistence layer — IndexedDB replaces localStorage for richer offline data with sync tracking.

