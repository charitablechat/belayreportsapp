import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/**
 * Audit L1 — autocomplete_history.synced boolean → 0|1 coercion.
 *
 * Before this change, writers passed `synced: boolean`. IndexedDB
 * silently drops boolean values from indexes because booleans aren't
 * valid IDB keys. The `by-synced` index returned no rows, so
 * `getUnsyncedAutocompleteEntries` returned [] even when unsynced rows
 * existed — autocomplete suggestions captured offline never pushed to
 * the server until the user re-edited the same field.
 *
 * Behaviour pinned:
 *   - Writing with `synced: false` round-trips through the index as
 *     `synced: 0` (queryable via `IDBKeyRange.only(0)`).
 *   - Writing with `synced: true` similarly round-trips as `synced: 1`.
 *   - Bulk-put coerces every entry, not just the first.
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

beforeEach(() => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  vi.resetModules();
});

describe('Audit L1 — autocomplete_history.synced is indexed as 0|1', () => {
  it('round-trips a boolean false through getUnsyncedAutocompleteEntries', async () => {
    const { putAutocompleteEntry, getUnsyncedAutocompleteEntries } = await import('../offline-storage');
    await putAutocompleteEntry({
      id: 'site_name::Camp Foo',
      field_type: 'site_name',
      value: 'Camp Foo',
      usage_count: 1,
      last_used_at: new Date().toISOString(),
      synced: false,
    });
    const unsynced = await getUnsyncedAutocompleteEntries();
    expect(unsynced.map(e => e.id)).toContain('site_name::Camp Foo');
  });

  it('round-trips a boolean true so the row drops out of the unsynced index', async () => {
    const { putAutocompleteEntry, getUnsyncedAutocompleteEntries } = await import('../offline-storage');
    await putAutocompleteEntry({
      id: 'site_name::Camp Bar',
      field_type: 'site_name',
      value: 'Camp Bar',
      usage_count: 5,
      last_used_at: new Date().toISOString(),
      synced: true,
    });
    const unsynced = await getUnsyncedAutocompleteEntries();
    expect(unsynced.map(e => e.id)).not.toContain('site_name::Camp Bar');
  });

  it('coerces every entry passed through bulkPutAutocompleteEntries', async () => {
    const { bulkPutAutocompleteEntries, getUnsyncedAutocompleteEntries } = await import('../offline-storage');
    await bulkPutAutocompleteEntries([
      { id: 'a::1', field_type: 'a', value: '1', usage_count: 1, last_used_at: new Date().toISOString(), synced: false },
      { id: 'a::2', field_type: 'a', value: '2', usage_count: 1, last_used_at: new Date().toISOString(), synced: false },
      { id: 'a::3', field_type: 'a', value: '3', usage_count: 1, last_used_at: new Date().toISOString(), synced: true },
    ]);
    const unsynced = await getUnsyncedAutocompleteEntries();
    const ids = unsynced.map(e => e.id).sort();
    expect(ids).toEqual(['a::1', 'a::2']);
  });

  it('also accepts numeric synced values without re-coercion', async () => {
    const { putAutocompleteEntry, getUnsyncedAutocompleteEntries } = await import('../offline-storage');
    await putAutocompleteEntry({
      id: 'site_name::Already Numeric',
      field_type: 'site_name',
      value: 'Already Numeric',
      usage_count: 1,
      last_used_at: new Date().toISOString(),
      synced: 0,
    });
    const unsynced = await getUnsyncedAutocompleteEntries();
    expect(unsynced.map(e => e.id)).toContain('site_name::Already Numeric');
  });
});
