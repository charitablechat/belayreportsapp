

## Always Render Comments as Bullet Lists in Reports

### Problem

In `formatCommentsAsBullets()` (line 222-224 of `generate-inspection-html/index.ts`), single-item comments are returned as plain text. This means entries with only "Tightened bolts and connectors as needed" appear without a bullet, while entries with additional user text get bullets. The screenshot confirms this inconsistency.

### Fix

**File: `supabase/functions/generate-inspection-html/index.ts`** — lines 222-225

Remove the single-item special case. Always render as a `<ul>` bullet list regardless of item count:

```typescript
// Before:
if (items.length === 1) {
  return items[0];
}

// After: remove this block entirely — all items fall through to the bullet list rendering below
```

This single change ensures every comment (1 item or many) is wrapped in `<ul><li>` markup, matching the reference screenshot.

### No other changes needed

- The PDF generator uses a separate rendering path but pulls from the same data — verify if it also needs the same treatment. (It uses `stripHtml` so bullets don't apply there.)
- Database content is unchanged.

