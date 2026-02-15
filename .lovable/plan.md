

# Fix Text Wrapping in Systems Area (Inspection Form)

## Problem

The inspection form's navigation tabs and table columns in the "Systems - Ziplines" section suffer from text wrapping/truncation at certain viewport widths. Specifically:

1. **Tab Navigation Bar**: Labels like "Systems - Ziplines" and "Operations Criteria" wrap awkwardly in the 2-column mobile grid layout
2. **Operating Systems Table**: The "Element Name" and "Operating System" columns in the desktop table can compress, causing text to wrap or be clipped
3. **Ziplines Table**: With 13 columns in the desktop view, all columns are extremely compressed, clipping "Line Name" and other content

## Solution

### 1. Tab Navigation Labels (InspectionForm.tsx, ~line 2208-2225)

- Add `whitespace-nowrap` to each `TabsTrigger` to prevent label wrapping
- Use clearer short labels on mobile: keep "Systems" and "Criteria" as-is (already shortened)
- On desktop, keep full labels but ensure `min-w-0` and `text-center` for balanced distribution

### 2. Operating Systems Table (OperatingSystemsTable.tsx)

- Add `min-w-[180px]` to the "Element Name" column header and cells to guarantee enough space for names
- Add `min-w-[160px]` to the "Operating System" column to prevent the select dropdown from being clipped
- Change the table container from `overflow-x-auto` to ensure full visibility while still allowing horizontal scroll when needed on smaller desktop screens

### 3. Ziplines Table (ZiplinesTable.tsx)

- Add `min-w-[150px]` to the "Line Name" column to prevent name truncation
- Add `min-w-[1200px]` to the table element itself (inside the `overflow-x-auto` wrapper) to enforce a minimum table width and prevent column crushing
- This creates a horizontally scrollable table on narrower screens rather than compressing columns

## Files Changed

1. **`src/pages/InspectionForm.tsx`** -- Add `whitespace-nowrap` to TabsTrigger elements in the category navigation bar
2. **`src/components/inspection/OperatingSystemsTable.tsx`** -- Add `min-w` constraints to Element Name and Operating System columns
3. **`src/components/inspection/ZiplinesTable.tsx`** -- Add `min-w` to Line Name column; set minimum table width to prevent column crushing

## Technical Notes

- The mobile card views for both tables are unaffected (they use full-width stacked layouts)
- No logic or data changes -- purely CSS/layout adjustments
- Horizontal scrolling is preferred over text truncation for data-dense inspection tables, as full text visibility is the priority

