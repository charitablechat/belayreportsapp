

## Add Per-Item Photo Thumbnails to HTML/PDF Reports

### Problem
The `inspection_systems`, `inspection_ziplines`, and `inspection_equipment` tables each have a `photo_url` column storing per-item photos in the `inspection-photos` bucket. These photos are uploaded via the form UI but are **completely ignored** by the HTML report generator (`generate-inspection-html`). Only gallery photos from `inspection_photos` are rendered.

### Plan

**File: `supabase/functions/generate-inspection-html/index.ts`**

1. **Download per-item photos to base64** — After the existing gallery photo processing loop (lines 300-350), add a second pass that collects all `photo_url` values from `systems`, `ziplines`, and `equipment` arrays. For each non-null `photo_url`, download from the `inspection-photos` bucket and convert to a base64 data URI, storing results in a `Map<string, string>` keyed by storage path. Apply the same HEIC magic-byte skip logic.

2. **Add a "Photo" column to each table** — In all 6 table rendering locations (combined and non-combined paths for systems, ziplines, equipment):
   - Add a `<th>Photo</th>` column header
   - Add a `<td>` that renders either a 60×60px thumbnail (`<img>` with `object-fit: contain`) linked to the base64 data URI, or "—" if no photo exists
   - Update divider row `colspan` values accordingly

3. **Add thumbnail CSS** — Add styles for `.item-thumbnail` class:
   ```css
   .item-thumbnail {
     width: 60px;
     height: 60px;
     object-fit: contain;
     border-radius: 4px;
     border: 1px solid #e2e8f0;
   }
   ```
   With print media overrides ensuring visibility.

### Rendering locations to modify (6 total)

| Section | Path | Lines (approx) |
|---------|------|----------------|
| Systems table | Combined | ~1904-1931 |
| Systems table | Standalone | ~2030-2055 |
| Ziplines table | Combined | ~1950-1991 |
| Ziplines table | Standalone | ~2101-2142 |
| Equipment table | Combined | ~2210-2235 |
| Equipment table | Standalone | ~2340-2365 |

### Technical details

- Reuse the existing `arrayBufferToBase64` helper and HEIC detection logic
- Build the photo map once upfront; look up by storage path when rendering each row
- The thumbnail column will be narrow (60px) to avoid disrupting the existing table layout
- For ziplines tables (already 10 columns), the photo column adds minimal width since the thumbnail is fixed-size

