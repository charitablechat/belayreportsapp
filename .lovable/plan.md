

# Clean Default Bolt Text from Database Records

## Problem
76 records in `inspection_systems` and 11 in `inspection_ziplines` contain the default text `<p>Tightened bolts and connectors as needed</p>` stored in the `comments` column. This text should only appear during report generation (already handled by `prependDefaultBolt` in the edge function).

## Data Patterns Found

All instances are HTML-wrapped: `<p>Tightened bolts and connectors as needed</p>`

Two cases:
1. **Only bolt text** (14 systems records): `<p>Tightened bolts and connectors as needed</p>` → set to `NULL`
2. **Bolt text + real comments** (62 systems, 11 ziplines): `<p>Tightened bolts and connectors as needed</p><p>Real comment here</p>` → strip the bolt paragraph, keep the rest

## Plan

### Step 1: Database cleanup via data update tool (2 queries)

**Systems — records with ONLY bolt text:**
```sql
UPDATE inspection_systems 
SET comments = NULL 
WHERE comments = '<p>Tightened bolts and connectors as needed</p>';
```

**Systems — records with bolt text + real content:**
```sql
UPDATE inspection_systems 
SET comments = REPLACE(comments, '<p>Tightened bolts and connectors as needed</p>', '')
WHERE comments ILIKE '%tightened bolts and connectors as needed%'
  AND comments != '<p>Tightened bolts and connectors as needed</p>';
```

**Ziplines — same two queries:**
```sql
UPDATE inspection_ziplines 
SET comments = NULL 
WHERE comments = '<p>Tightened bolts and connectors as needed</p>';

UPDATE inspection_ziplines 
SET comments = REPLACE(comments, '<p>Tightened bolts and connectors as needed</p>', '')
WHERE comments ILIKE '%tightened bolts and connectors as needed%'
  AND comments != '<p>Tightened bolts and connectors as needed</p>';
```

### Step 2: No code changes needed

- The edge function `prependDefaultBolt` already re-adds the text during HTML report generation
- No frontend code sets this default text (verified — zero matches in `src/`)
- The date-saving fix from the previous session is unrelated and unaffected

### Verification

After cleanup, run:
```sql
SELECT COUNT(*) FROM inspection_systems WHERE comments ILIKE '%tightened bolts%';
SELECT COUNT(*) FROM inspection_ziplines WHERE comments ILIKE '%tightened bolts%';
```
Both should return 0.

