

## Fix — Coerce `uploaded` to `0 | 1` everywhere (fix `by-uploaded` index)

### Problem

The `photos` store has an index `by-uploaded` keyed on the `uploaded` field. IndexedDB **cannot index boolean values** — `true`/`false` are silently dropped from the index. Today `getUnuploadedPhotos()` queries `index.getAll(IDBKeyRange.only(0))` while writers store `uploaded: false`. This means the index returns nothing, and the only reason photo sync works at all is incidental fallbacks elsewhere. Same hazard at the SW (`p.uploaded` truthy check works, but any IDB index path is broken).

### Plan

#### 1. Type change — `src/lib/offline-storage.ts` line 48

```ts
uploaded: 0 | 1;
```

Also tighten the `savePhotoOffline` arg type (line 1908) to `uploaded?: 0 | 1 | boolean` so existing callers (`PhotoCapture.tsx`, `ItemPhotoUpload.tsx`, `local-backup-ledger.ts`) still compile during the cutover; coerce inside.

#### 2. Coerce at every IDB write site

- **`savePhotoOffline`** (line 1931): `uploaded: photo.uploaded ? 1 : 0`
- **`markPhotoAsUploaded`** (line 2217): `photo.uploaded = 1`
- **`pruneOldSyncedPhotoBlobs`** etc. — no writes to the field, only reads.
- **`public/sw-sync.js`** (line 579): `photo.uploaded = 1` (and the filter at 513 stays truthy-safe: `p => !p.uploaded` works for both `0` and `false`).
- **`src/lib/photo-cache.ts`** line 40: `uploaded: 1`.
- **`src/lib/photo-receipts.ts`** is `localStorage`-backed (separate store, not IDB-indexed) — keep `boolean`. No change.

#### 3. Update internal comparisons in `src/lib/offline-storage.ts`

The four flagged sites (now at 2458, 2488, 3858, 3890, 4007, 4046) — switch boolean comparisons to numeric:
- `!p.uploaded` → keep (works for `0`)
- `p.uploaded === false` → `p.uploaded === 0` (lines 3858, 3890 comment, 4007)
- `photo.uploaded === true` → `photo.uploaded === 1` (line 4046)
- `photo.uploaded = true` → `photo.uploaded = 1` (line 2217)

#### 4. External read sites — keep truthy-style, no breaking change

`PhotoGallery.tsx`, `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`, `offline-auth.ts` all use `!p.uploaded` / `p.uploaded` truthy checks. These work correctly for both `0`/`1` and `false`/`true` — leave untouched. The `PhotoGallery` interface at line 63 (`uploaded: boolean`) is a UI-layer DTO; leave it as `boolean` since it's never indexed and the truthy coercion is safe. Add a small `Boolean(p.uploaded)` at the mapping sites (PhotoGallery 215, 262, 294; forms 272/354/273) to normalize for the UI type.

#### 5. IDB schema upgrade — bump to v16

In `public/db-config.js`: `version: 16`. In `src/lib/offline-storage.ts` `DB_VERSION = 16`. The build-time parity check (Fix 3.C) enforces both bump together.

Add an `if (oldVersion < 16)` branch inside the existing `upgrade(db, oldVersion, newVersion, transaction)` callback in `getDB()`. The branch:
1. Opens a cursor over `photos` via `transaction.objectStore('photos')`.
2. For each record where `typeof v.uploaded === 'boolean'`, rewrites to `0 | 1` and `cursor.update(v)`.
3. Wrapped in the existing migration-snapshot safety (Phase 5) so a failed pass is recoverable.

Index recreation isn't required — the index definition (`'uploaded'`) is unchanged; rewriting the values causes IDB to re-key them automatically on `update()`.

#### 6. Regression test — `src/lib/__tests__/photo-uploaded-index.test.ts`

New test using `fake-indexeddb` (already a transitive dep via the existing `offline-storage-save-boundary.test.ts` setup — verify in test/setup.ts; if absent, add `fake-indexeddb/auto` import to the new file). Two cases:

```ts
it('by-uploaded index returns unuploaded photos saved with boolean false', async () => {
  await savePhotoOffline({ id: '1', inspectionId: 'x', section: 's', blob, fileName: 'a.jpg', uploaded: false });
  const out = await getUnuploadedPhotos();
  expect(out).toHaveLength(1);
});

it('by-uploaded index excludes photos after markPhotoAsUploaded', async () => {
  await savePhotoOffline({ id: '2', inspectionId: 'x', section: 's', blob, fileName: 'b.jpg', uploaded: false });
  await markPhotoAsUploaded('2', 'path/b.jpg');
  const out = await getUnuploadedPhotos();
  expect(out.find(p => p.id === '2')).toBeUndefined();
});
```

#### 7. Memory note

Append a one-liner to `mem://index.md` Core: "IDB cannot index booleans — `photos.uploaded` is `0 | 1`, never boolean."

### Out of scope

- Rewriting external truthy reads (`!p.uploaded`) — they're correct for both shapes; churn-only.
- Migrating `photo-receipts.ts` (localStorage, not indexed).
- SW does not query the index — only filters in-memory — but the `photo.uploaded = 1` write keeps cross-context consistency.

### Files touched

1. `src/lib/offline-storage.ts` — type, two write sites, ~5 comparison updates, v16 upgrade branch, `DB_VERSION = 16`.
2. `public/db-config.js` — `version: 16`.
3. `public/sw-sync.js` — `photo.uploaded = 1` at line 579.
4. `src/lib/photo-cache.ts` — `uploaded: 1` at line 40.
5. `src/components/PhotoGallery.tsx`, `src/pages/{Inspection,Training,DailyAssessment}Form.tsx` — wrap mapped `uploaded` in `Boolean(...)` (~5 sites) for the boolean UI DTO.
6. `src/lib/__tests__/photo-uploaded-index.test.ts` — new regression test.
7. `mem://index.md` — Core one-liner.

