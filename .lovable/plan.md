

## Fix: Remove "Tightened bolts and connectors as needed" from Database Records

**Problem**: The retroactive migration wrote the default bolt text directly into the `comments` column of `inspection_systems` and `inspection_ziplines`. This causes it to appear in the editing UI. The text should only appear in generated HTML/PDF reports via the `prependDefaultBolt()` helper in `generate-inspection-html`.

**Fix**: Run a reversal migration to undo the retroactive changes:

```sql
-- Remove from inspection_systems
UPDATE inspection_systems
SET comments = CASE
  WHEN TRIM(comments) = 'Tightened bolts and connectors as needed' THEN NULL
  WHEN comments LIKE 'Tightened bolts and connectors as needed' || E'\n' || '%'
    THEN SUBSTRING(comments FROM LENGTH('Tightened bolts and connectors as needed' || E'\n') + 1)
  ELSE comments
END;

-- Remove from inspection_ziplines (same logic)
UPDATE inspection_ziplines
SET comments = CASE
  WHEN TRIM(comments) = 'Tightened bolts and connectors as needed' THEN NULL
  WHEN comments LIKE 'Tightened bolts and connectors as needed' || E'\n' || '%'
    THEN SUBSTRING(comments FROM LENGTH('Tightened bolts and connectors as needed' || E'\n') + 1)
  ELSE comments
END;
```

**Logic**:
- If the comment is *only* the default text → set to NULL (restores original empty state)
- If it was prepended before other comments → strip the prefix, keep the rest
- Otherwise → leave unchanged

**No code changes needed** — the `prependDefaultBolt()` helper in `generate-inspection-html` already handles injecting this text at report generation time.

