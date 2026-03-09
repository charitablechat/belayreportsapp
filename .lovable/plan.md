
## Retroactive Default Comment Migration

**Goal**: Update all existing `inspection_systems` and `inspection_ziplines` records to prepend "Tightened bolts and connectors as needed" to their `comments` field.

### Database Migration

A single SQL migration will:

1. **Update `inspection_systems`** — Prepend the default text to all rows where it doesn't already exist
2. **Update `inspection_ziplines`** — Same logic

**SQL Logic**:
```sql
-- inspection_systems
UPDATE inspection_systems
SET comments = CASE
  WHEN comments IS NULL OR TRIM(comments) = '' THEN 'Tightened bolts and connectors as needed'
  WHEN comments LIKE '%Tightened bolts and connectors as needed%' THEN comments
  ELSE 'Tightened bolts and connectors as needed' || E'\n' || comments
END;

-- inspection_ziplines (same pattern)
```

### Safety Considerations

- **Idempotent**: The query checks if the text already exists before prepending
- **Preserves existing data**: Appends to existing comments, doesn't overwrite
- **Handles nulls/empty**: Sets the default text directly for empty fields
- **No FK changes**: Only modifies `comments` column values

### Tables Affected
| Table | Column | Records |
|-------|--------|---------|
| `inspection_systems` | `comments` | All rows |
| `inspection_ziplines` | `comments` | All rows |

Equipment and Standards tables remain untouched per the original requirement.
