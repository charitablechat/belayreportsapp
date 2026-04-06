

# Fix: Training Summary Bullet Points Not Rendering in HTML Report

## Problem

The rich text editor (TipTap) stores each line as a `<p>` tag:
```html
<p>It is recommended that the site institute a written pre-use checklist</p>
<p>It is recommended that maintenance check the sturdiness...</p>
<p>It is recommended that a rope for each the TTT...</p>
```

The `parseTextToList()` function in `training-formatter.ts` calls `stripHtml()` first, which does `html.replace(/<[^>]*>/g, '')`. This strips **all** tags without inserting any separators, so the three paragraphs become one continuous string:

```
"It is recommended that the site institute...checklistIt is recommended that maintenance check..."
```

The sentence-splitting regex then partially recovers this (splitting on `. Capital`), but since these lines don't end with periods, they get concatenated into a single bullet point — exactly what the screenshot shows.

## Fix

**File: `supabase/functions/_shared/training-formatter.ts`**

Update `parseTextToList()` to convert block-level HTML boundaries (`</p>`, `</div>`, `<br>`, `</li>`) into newline characters **before** stripping HTML tags. This preserves the line structure the user entered in the editor.

```typescript
export function parseTextToList(textContent: string | null | undefined): string[] {
  if (!textContent) return [];
  
  // Convert block-level HTML boundaries to newlines BEFORE stripping tags
  let preprocessed = textContent
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  
  let text = stripHtml(preprocessed);
  if (!text || text === 'N/A') return [];
  
  // ... rest of the function stays the same
```

This is a one-line-category fix in a single shared file. No other files need changes — the HTML generation template already correctly renders `observationsList` and `recommendationsList` as `<li>` elements.

