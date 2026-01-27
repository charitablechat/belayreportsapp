

## Fix Empty Bullet Points in Developer Notes Card

### Problem Analysis

Based on the database content inspection, the Developer Notes contain:

```html
<ul>
  <li><p>Actual content here</p></li>
  <li><p></p></li>  <!-- Empty bullet - problematic -->
  <li><p>More content</p></li>
  <li><p></p></li>  <!-- Empty bullet - problematic -->
</ul>
<p>Additional note</p>
<p></p>  <!-- Empty paragraph -->
```

The current `html-content-cleaner.ts` handles some patterns but misses:

1. **List items with paragraph-wrapped empty content** - TipTap generates `<li><p></p></li>` when pressing Enter in bullet lists
2. **Chained empty paragraphs** - Multiple `<p></p>` that get converted to empty bullets
3. **Content after bullet lists** - Text in `<p>` tags after the `<ul>` that should also become bullets

---

### Root Cause

The `cleanHtmlContent` function has a regex for `<li>\s*<p>\s*<\/p>\s*<\/li>` but:
- It needs to also handle the case where there's no whitespace at all: `<li><p></p></li>`
- The regex should work (since `\s*` matches zero or more), but the order of operations matters
- Additionally, after cleaning the `<ul>`, if there are remaining `<p>` tags, they're converted to new bullets - including empty ones

The `convertToBulletList` function needs enhancement:
- When content already has `<ul>` tags, it returns early **before** doing the paragraph-to-bullet conversion for the remaining text after the list
- This leaves trailing paragraphs rendered separately instead of as bullets

---

### Solution

Enhance `src/lib/html-content-cleaner.ts` with:

1. **More aggressive empty content removal**:
   - Handle `<li><p></p></li>` with no whitespace
   - Handle `<li><p><br></p></li>` (empty with line break)
   - Handle `<li><p>&nbsp;</p></li>` (empty with non-breaking space)

2. **Post-clean validation**:
   - After initial clean, run a second pass to catch any remaining empty patterns
   - Remove any `<li>` tags whose inner text content is empty after stripping HTML

3. **Unified bullet conversion**:
   - When content has mixed `<ul>` and `<p>` sections, extract all content and rebuild as a single unified list
   - Ensure ALL lines become bullet points as requested

---

### Implementation Steps

#### Step 1: Update `cleanHtmlContent` function

Add more comprehensive patterns:

```typescript
// Handle empty list items with various empty paragraph patterns
cleaned = cleaned.replace(/<li>\s*<p>\s*<\/p>\s*<\/li>/gi, '');
cleaned = cleaned.replace(/<li><p><\/p><\/li>/gi, ''); // Exact match, no whitespace
cleaned = cleaned.replace(/<li>\s*<p>\s*<br\s*\/?>\s*<\/p>\s*<\/li>/gi, '');
cleaned = cleaned.replace(/<li>\s*<p>(&nbsp;|\s)*<\/p>\s*<\/li>/gi, '');

// Handle list items that are just whitespace (no paragraph wrapper)
cleaned = cleaned.replace(/<li>(\s|&nbsp;)*<\/li>/gi, '');
```

#### Step 2: Update `convertToBulletList` function

Instead of returning early when `<ul>` exists, extract ALL content and rebuild:

```typescript
export function convertToBulletList(htmlContent: string): string {
  if (!htmlContent) return '';
  
  // First clean the content
  let cleaned = cleanHtmlContent(htmlContent);
  
  // Extract ALL text content regardless of existing structure
  // This ensures mixed content (ul + p) becomes unified bullets
  
  // 1. Extract text from existing list items
  const listItemMatches = cleaned.match(/<li>.*?<\/li>/gi) || [];
  const listTexts = listItemMatches
    .map(li => li.replace(/<\/?li>/gi, '').replace(/<\/?p>/gi, '').trim())
    .filter(text => text.length > 0 && text !== '<br>' && text !== '&nbsp;');
  
  // 2. Remove existing ul structure to get remaining paragraphs
  let remaining = cleaned.replace(/<ul>.*?<\/ul>/gi, '');
  
  // 3. Extract text from remaining paragraphs
  const paragraphs = remaining
    .split(/<\/?p>/gi)
    .map(p => p.trim())
    .filter(p => {
      const stripped = p.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, '').trim();
      return stripped.length > 0;
    });
  
  // 4. Combine all items
  const allItems = [...listTexts, ...paragraphs];
  
  if (allItems.length === 0) return '';
  
  // 5. Build unified bullet list
  const listItems = allItems.map(item => `<li>${item}</li>`).join('');
  return `<ul>${listItems}</ul>`;
}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/html-content-cleaner.ts` | Enhance regex patterns, rebuild `convertToBulletList` logic |

---

### Expected Result

Before (current display):
```
• Content 1
•           ← Empty bullet
• Content 2
•           ← Empty bullet
Content 3   ← Not a bullet
```

After (fixed display):
```
• Content 1
• Content 2
• Content 3
```

All inputted data will render as proper bullet points with no empty bullets.

