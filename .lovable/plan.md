
## Fix: Complete Removal of Default Bolt Text from Database

**Problem**: The previous reversal migration didn't account for HTML-formatted versions of the text. The database contains `<p>Tightened bolts and connectors as needed</p>` in the `comments` field.

### Solution

Run a SQL UPDATE that handles both plain text AND HTML-wrapped variants:

```sql
-- inspection_systems
UPDATE inspection_systems
SET comments = CASE
  -- Exact HTML match
  WHEN TRIM(comments) = '<p>Tightened bolts and connectors as needed</p>' THEN NULL
  -- Plain text match
  WHEN TRIM(comments) = 'Tightened bolts and connectors as needed' THEN NULL
  -- HTML prefix with newline
  WHEN comments LIKE '<p>Tightened bolts and connectors as needed</p>' || E'\n' || '%'
    THEN SUBSTRING(comments FROM LENGTH('<p>Tightened bolts and connectors as needed</p>' || E'\n') + 1)
  -- Plain text prefix with newline
  WHEN comments LIKE 'Tightened bolts and connectors as needed' || E'\n' || '%'
    THEN SUBSTRING(comments FROM LENGTH('Tightened bolts and connectors as needed' || E'\n') + 1)
  ELSE comments
END;

-- inspection_ziplines (same pattern)
```

**Records affected**: All `inspection_systems` and `inspection_ziplines` rows containing the default bolt text in any format.

**No code changes needed** — the `prependDefaultBolt()` helper in `generate-inspection-html` already handles injecting this text at report generation time only.
