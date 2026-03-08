

## Conditional Default Comment: UI vs Report

**Goal**: Remove "Tightened bolts and connectors as needed" from the editing interface, but ensure it still appears in generated HTML/PDF reports for Ziplines and Operating Systems entries.

### Changes

**1. Remove default from UI initialization (2 files)**

- `src/components/inspection/ZiplinesTable.tsx` (line 53): Change `comments` from `"<p>Tightened bolts and connectors as needed</p>"` to `""`
- `src/components/inspection/OperatingSystemsTable.tsx` (line 43): Same change

**2. Prepend default in report generator (1 file)**

- `supabase/functions/generate-inspection-html/index.ts`: Modify `formatCommentsAsBullets` calls for ziplines and operating_systems sections to prepend the default text before formatting.

Add a helper:
```typescript
function prependDefaultBolt(comments: string | null | undefined): string {
  const defaultText = "Tightened bolts and connectors as needed";
  if (!comments || comments.trim() === "" || comments === "—") {
    return `<p>${defaultText}</p>`;
  }
  // Prepend if not already present
  if (comments.includes(defaultText)) return comments;
  return `<p>${defaultText}</p>${comments}`;
}
```

Apply `prependDefaultBolt()` to `sys.comments` and `zip.comments` before passing to `formatCommentsAsBullets()` in all 4 render locations (desktop + mobile for both tables). Equipment and Standards tables are untouched.

### Files Modified
- `src/components/inspection/ZiplinesTable.tsx` — remove default comment
- `src/components/inspection/OperatingSystemsTable.tsx` — remove default comment  
- `supabase/functions/generate-inspection-html/index.ts` — add helper + apply to ziplines & operating systems sections

### What's NOT Changed
- EquipmentTable (already excluded per existing rule)
- StandardsTable (not applicable)
- Existing reports in the database (their stored comments are unchanged; the report generator handles prepending)

