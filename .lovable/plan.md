

## Retroactive Default Comment for All Existing Equipment & Zipline Entries

### Data Summary

| Table | Total Rows | Empty Comments | Has Comments | Already Has Default |
|-------|-----------|----------------|--------------|---------------------|
| inspection_equipment | 200 | 153 | 47 | 0 |
| inspection_ziplines | 21 | all need check | some | 0 |

### Approach

Run two UPDATE statements via the insert tool (data operation, not schema change):

**1. Empty/blank comments** — replace with just the default text:
```sql
UPDATE inspection_equipment
SET comments = '<p>Tightened bolts and connectors as needed</p>'
WHERE comments IS NULL OR comments = '' OR comments = '<p></p>';
```

**2. Existing comments** — prepend default text before existing content:
```sql
UPDATE inspection_equipment
SET comments = '<p>Tightened bolts and connectors as needed</p>' || comments
WHERE comments IS NOT NULL AND comments != '' AND comments != '<p></p>'
  AND comments NOT LIKE '%Tightened bolts and connectors as needed%';
```

Same two queries for `inspection_ziplines`.

### Impact

- 200 equipment rows and 21 zipline rows updated
- Existing user comments preserved — default text prepended above them
- Already-applied rows (if any) skipped via the `NOT LIKE` guard
- Reports (HTML/PDF) will reflect the change automatically since they read from the database

### No Code Changes

No frontend or edge function changes needed — this is a data-only update.

