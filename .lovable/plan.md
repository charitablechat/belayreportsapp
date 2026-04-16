

# Alternating Row Colors for Equipment Type Dropdown

## What
Add a light blue / grey alternating "checker" pattern to the dropdown items in `EquipmentTypeCombobox.tsx` so users can visually distinguish between adjacent choices.

## How

**File: `src/components/inspection/EquipmentTypeCombobox.tsx`**

In the `filteredOptions.map()` block (line ~236), use the array index to apply alternating background colors:

- Even rows: `bg-blue-50` (very light blue)
- Odd rows: `bg-gray-50` (very light grey)

```tsx
{filteredOptions.map((opt, index) => (
  <CommandItem
    key={opt}
    value={opt}
    onSelect={() => handleSelect(opt)}
    className={cn(
      "cursor-pointer",
      index % 2 === 0 ? "bg-blue-50" : "bg-gray-50"
    )}
  >
```

The hover state (`data-[selected='true']:bg-accent`) from `CommandItem` will still override these backgrounds when an item is highlighted, maintaining the existing interaction feel.

**Single file change, no database or migration work needed.**

