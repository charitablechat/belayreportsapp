

# Show Full Entry Names on One Line

## Problem

The autocomplete dropdown matches the input field width, which on mobile is narrow (~300px). Long entries like "Singing Rock Technic Speed Steel Harness" cannot fit on one line.

## Solution

Make the popover wider than the trigger on mobile by using `min-width` instead of `width`, and allow it to grow up to the viewport width.

### File: `src/components/GlobalAutocomplete.tsx`

**Change the PopoverContent className (line 366)**

From:
```tsx
<PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
```

To:
```tsx
<PopoverContent className="min-w-[--radix-popover-trigger-width] w-auto max-w-[calc(100vw-2rem)] p-0" align="start">
```

This ensures:
- The dropdown is at least as wide as the input field
- It can grow wider to fit long text on a single line
- It never exceeds the viewport width (with 1rem margin on each side)
- Entries with short text still look compact

Additionally, add `whitespace-nowrap` to the entry text span (line ~418) to prevent wrapping:

```tsx
<span className="break-words whitespace-nowrap">{option.value}</span>
```

This combination keeps every entry on a single readable line while the popover auto-sizes to fit.

