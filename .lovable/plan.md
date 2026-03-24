

## Fix: Text Not Wrapping in Inspection Table Comments on Mobile/Tablet

### Problem
On iPad and other tablet/mobile devices, text in the "Comments" column of inspection tables (Ziplines, Equipment, Operating Systems) overflows its cell instead of wrapping. This is caused by two issues:

1. The TipTap rich text editor's `.prose` class doesn't enforce word-breaking, so long text or continuous words can overflow the grid cell.
2. The grid column definitions use fixed or `1fr` widths without `overflow: hidden` or `min-width: 0` on the cells, allowing content to push beyond boundaries.

### Changes

**1. `src/components/ui/rich-text-editor.tsx` (line 69)**
Add word-breaking and overflow-wrap to the editor's prose container:
```
// Before:
class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] px-3 py-2',

// After:
class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] px-3 py-2 break-words overflow-wrap-anywhere',
```

**2. `src/index.css`**
Add a global CSS rule targeting TipTap's `.ProseMirror` content to ensure text wraps on all devices:
```css
.ProseMirror {
  word-break: break-word;
  overflow-wrap: anywhere;
}
```

**3. Grid cell overflow fix in all 3 table components**
Add `min-w-0 overflow-hidden` to the comments column `<div>` wrapper in:
- `ZiplinesTable.tsx` (desktop comments cell, ~line 189)
- `EquipmentTable.tsx` (desktop comments cell)
- `OperatingSystemsTable.tsx` (desktop comments cell)

This ensures the grid child respects its track size and doesn't overflow.

### Files
| File | Change |
|------|--------|
| `src/components/ui/rich-text-editor.tsx` | Add `break-words overflow-wrap-anywhere` to editor attributes |
| `src/index.css` | Add `.ProseMirror { word-break: break-word; overflow-wrap: anywhere; }` |
| `src/components/inspection/ZiplinesTable.tsx` | Add `min-w-0 overflow-hidden` to comments cell div |
| `src/components/inspection/EquipmentTable.tsx` | Same |
| `src/components/inspection/OperatingSystemsTable.tsx` | Same |

