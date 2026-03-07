

## Default Comment: Add to Operating Systems, Remove from Equipment

### Code Changes

**1. `src/components/inspection/OperatingSystemsTable.tsx`** — line 43
Change `comments: ""` to `comments: "<p>Tightened bolts and connectors as needed</p>"`

**2. `src/components/inspection/EquipmentTable.tsx`** — line 219
Change `comments: "<p>Tightened bolts and connectors as needed</p>"` back to `comments: ""`

### Database Updates (via insert tool)

**3. Add default to all existing operating system rows:**
```sql
-- Empty comments
UPDATE inspection_systems
SET comments = '<p>Tightened bolts and connectors as needed</p>'
WHERE comments IS NULL OR comments = '' OR comments = '<p></p>';

-- Existing comments — prepend
UPDATE inspection_systems
SET comments = '<p>Tightened bolts and connectors as needed</p>' || comments
WHERE comments IS NOT NULL AND comments != '' AND comments != '<p></p>'
  AND comments NOT LIKE '%Tightened bolts and connectors as needed%';
```

**4. Remove default from all existing equipment rows:**
```sql
-- Where the default is the ONLY content, clear it
UPDATE inspection_equipment
SET comments = ''
WHERE comments = '<p>Tightened bolts and connectors as needed</p>';

-- Where the default is prepended before other content, strip it
UPDATE inspection_equipment
SET comments = REPLACE(comments, '<p>Tightened bolts and connectors as needed</p>', '')
WHERE comments LIKE '%Tightened bolts and connectors as needed%'
  AND comments != '<p>Tightened bolts and connectors as needed</p>';
```

### No Report Changes Needed

Reports read `comments` directly from the database — changes will reflect automatically.

