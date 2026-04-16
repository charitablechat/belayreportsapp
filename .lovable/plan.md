

# Darker Blue Checkers in Equipment Dropdowns

## Change

**File: `src/components/inspection/EquipmentTypeCombobox.tsx`**

Replace `bg-blue-50` with `bg-blue-100` in the alternating row pattern (line ~238):

```tsx
className={cn(
  "cursor-pointer",
  index % 2 === 0 ? "bg-blue-100" : "bg-gray-50"  // Changed from bg-blue-50
)}
```

This makes the blue rows one shade darker in Tailwind's color scale while maintaining the alternating pattern with grey.

