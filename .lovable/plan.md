

# Fix Autocomplete Entry Text Wrapping

## Problem

The current `break-all` CSS class breaks text at any character boundary, causing words to split mid-syllable (e.g., "Te-chnic", "Ste-el", "P-ro"). This makes entries very hard to read.

## Changes

### File: `src/components/GlobalAutocomplete.tsx`

**1. Replace `break-all` with proper word wrapping (line ~418)**

Change the entry text span from:
```tsx
<span className="break-all">{option.value}</span>
```
to:
```tsx
<span className="break-words">{option.value}</span>
```

`break-words` (Tailwind for `overflow-wrap: break-word`) only breaks at word boundaries, keeping "Singing Rock Technic Speed Steel Harness" readable across lines.

**2. Add `min-w-0` to the flex container (line ~411)**

The parent flex div needs `min-w-0` so the text container can shrink and wrap properly instead of overflowing:
```tsx
<div className="flex items-center flex-1 min-w-0">
```

**3. Increase the ScrollArea height (line ~404)**

Bump from `h-[200px]` to `h-[240px]` to give more vertical room for wrapped entries.

These three small CSS changes will make all entries wrap cleanly at word boundaries while keeping the delete button accessible.

