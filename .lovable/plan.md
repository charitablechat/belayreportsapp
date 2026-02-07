

# Fix Plan: "Invalid UUID" Validation Error on Report Completion - v2.4.7

## Root Cause

When you add items (operating systems, equipment, ziplines, etc.) to an inspection report, each new item gets a temporary ID like `temp-abc123...`. This is by design — the `temp-` prefix marks items that haven't been synced to the server yet.

The problem: when you click "Complete", a validation step checks every item's ID and requires it to be a strict UUID format. The `temp-` prefix makes it fail, producing the "invalid uuid" error for every unsaved item — hence "+24 issues" if you have 25 items with temporary IDs.

**This is purely a validation schema issue.** The data is fine; the validator is too strict about ID format for in-memory items that haven't been synced yet.

## Solution

Relax the `id` field validation in the schemas to accept both standard UUIDs and `temp-`-prefixed UUIDs. This way, completion validation passes for new items, and the sync layer continues to strip the `temp-` prefix before sending data to the server (that logic already works correctly).

## Technical Details

**File: `src/lib/validation-schemas.ts`**

Create a reusable custom validator that accepts both formats:

```typescript
// Accept both "real" UUIDs and temp-prefixed UUIDs used before sync
const flexibleUUID = z.string().refine(
  (val) => {
    const raw = val.startsWith('temp-') ? val.slice(5) : val;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
  },
  { message: "Invalid identifier" }
);
```

Then replace `z.string().uuid()` with `flexibleUUID` in these schemas:
- `systemSchema.id`
- `ziplineSchema.id` and `ziplineSchema.inspection_id`
- `equipmentSchema.id` and `equipmentSchema.inspection_id`
- `standardSchema.id` and `standardSchema.inspection_id`
- `summarySchema.id` and `summarySchema.inspection_id`

The `inspectionSchema` keeps strict `z.string().uuid()` since inspections always have real UUIDs from creation.

**File: `vite.config.ts`**

Bump version to **v2.4.7**.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/validation-schemas.ts` | Replace strict `.uuid()` with `flexibleUUID` for sub-item IDs |
| `vite.config.ts` | Version bump to v2.4.7 |

## Why This Is Safe

- The sync layer (`atomic-sync-manager.ts` line 131-134) already strips `temp-` prefixes before writing to the database
- The server-side columns remain true UUID type — only client-side validation is relaxed
- The `temp-` prefix convention is used consistently across all table components (Equipment, Ziplines, OperatingSystems)

## Expected Outcome

- Clicking "Complete" will no longer show the UUID validation error
- All 25 items that were failing will pass validation
- Reports can be completed and synced normally

