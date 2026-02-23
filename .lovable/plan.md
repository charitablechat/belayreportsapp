

## Fix: "Repairs, Alterations" Section Showing Items Without Comments

### Problem
The "Repairs, Alterations performed during inspection" summary field is populating with every "pass" item, even those that have no comments. This happens because the comments field uses a rich text editor (TipTap) which stores HTML. When a comment field is touched but left empty, it contains `<p></p>` or `<p><br></p>` -- these are truthy strings that pass the current `comments?.trim()` check.

### Root Cause
In `src/pages/InspectionForm.tsx` (lines 285-388), the `generateSummaryFromInspection` function checks `item.comments?.trim()` to decide whether to include a "pass" item in `repairsPerformed`. But since comments are HTML, an empty editor produces `"<p></p>"` which is truthy after `.trim()`.

### Solution

**1. Add a helper function to check for meaningful HTML content**

Add a `hasTextContent(html)` utility in `src/lib/html-content-cleaner.ts` that strips all HTML tags and checks if any visible text remains. This reuses the existing cleaning module.

```typescript
export function hasTextContent(html: string | null | undefined): boolean {
  if (!html) return false;
  const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
  return text.length > 0;
}
```

**2. Update the summary generation logic in `InspectionForm.tsx`**

Replace all three `comments?.trim()` checks (for equipment, operating systems, and ziplines) with `hasTextContent(comments)`:

- Line 306: `item.result === 'pass' && hasTextContent(item.comments)` (Equipment)
- Line 324: `system.result === 'pass' && hasTextContent(system.comments)` (Operating Systems)
- Line 361-362: Zipline pass-with-comments check uses `hasTextContent(zipline.comments)`

Also update the entry text construction (lines 300, 318, 366) so the comment portion only appends when there is actual text content, preventing trailing colons.

### Files Changed

| File | Change |
|------|--------|
| `src/lib/html-content-cleaner.ts` | Add `hasTextContent()` helper |
| `src/pages/InspectionForm.tsx` | Import and use `hasTextContent()` in `generateSummaryFromInspection` |

