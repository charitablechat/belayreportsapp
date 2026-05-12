import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/**
 * L-3 (audit): regression-lock the autocomplete `by-synced` index using
 * the same C1 contract proven for `photos.by-uploaded`.
 *
 * IndexedDB silently drops boolean values from indexes — keying must be
 * 0 | 1. Before this fix, `getUnsyncedAutocompleteEntries()` always
 * returned `[]` because writes stored `synced: false`, the `by-synced`
 * index never indexed those rows, and the `IDBKeyRange.only(0)` query
 * matched nothing.
 */
beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  vi.resetModules();
});

describe('L-3 — autocomplete by-synced index keys numeric 0|1', () => {
  it('putAutocompleteEntry with boolean false is queryable as unsynced', async () => {
    const { putAutocompleteEntry, getUnsyncedAutocompleteEntries } = await import('../offline-storage');
    await putAutocompleteEntry({
      id: 'organization::Acme',
      field_type: 'organization',
      value: 'Acme',
      usage_count: 1,
      last_used_at: new Date().toISOString(),
      synced: false,
    });
    const unsynced = await getUnsyncedAutocompleteEntries();
    expect(unsynced.length).toBe(1);
    expect(unsynced[0].id).toBe('organization::Acme');
  });

  it('synced=true entries are excluded from the unsynced query', async () => {
    const { putAutocompleteEntry, getUnsyncedAutocompleteEntries } = await import('../offline-storage');
    await putAutocompleteEntry({
      id: 'organization::Synced',
      field_type: 'organization',
      value: 'Synced',
      usage_count: 1,
      last_used_at: new Date().toISOString(),
      synced: true,
    });
    const unsynced = await getUnsyncedAutocompleteEntries();
    expect(unsynced.length).toBe(0);
  });

  it('bulkPutAutocompleteEntries coerces boolean → 0|1 at write boundary', async () => {
    const { bulkPutAutocompleteEntries, getUnsyncedAutocompleteEntries } = await import('../offline-storage');
    await bulkPutAutocompleteEntries([
      {
        id: 'location::A',
        field_type: 'location',
        value: 'A',
        usage_count: 1,
        last_used_at: new Date().toISOString(),
        synced: false,
      },
      {
        id: 'location::B',
        field_type: 'location',
        value: 'B',
        usage_count: 1,
        last_used_at: new Date().toISOString(),
        synced: true,
      },
    ]);
    const unsynced = await getUnsyncedAutocompleteEntries();
    expect(unsynced.length).toBe(1);
    expect(unsynced[0].id).toBe('location::A');
  });
});
