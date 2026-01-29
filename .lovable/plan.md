
# Implementation Plan: Operational Criteria Checkboxes, Bullet Formatting, and Cross-Report Memory

## Overview
This plan addresses three distinct requirements:

1. **Operational Criteria Section**: Replace the automatic "No" selection with manual checkboxes for both "Yes" and "No" options
2. **Comments/Required Changes Formatting**: Render multi-line content as bullet points in HTML and PDF reports
3. **Cross-Report Element Name Memory**: Implement persistent global storage for element names that syncs across all reports

---

## Part 1: Operational Criteria Manual Checkbox Control

### Current Behavior
In `StandardsTable.tsx`, the "NO" column displays a checkmark (`✓`) automatically when `has_documentation` is `false`. This is a static indicator, not a clickable control.

```typescript
// Current code (lines 80-84):
<td className="border p-3 text-center">
  <span className="text-sm font-medium">
    {standardData.has_documentation ? "" : "✓"}
  </span>
</td>
```

### Proposed Solution
Replace the static checkmark with an interactive `Checkbox` component that explicitly sets `has_documentation` to `false` when checked.

**Data Model Change**: The `has_documentation` field will change from a boolean to a tri-state concept:
- `true` = "Yes" checked
- `false` = "No" checked  
- `null` = Neither checked (default for new reports)

Since the database column is `NOT NULL`, we will use a new local state pattern where `has_documentation` starts as `null` in the UI state, and only persists to the database when explicitly set.

### Files to Modify

| File | Change |
|------|--------|
| `src/components/inspection/StandardsTable.tsx` | Add interactive checkbox for "NO" column |
| `src/pages/InspectionForm.tsx` | Update initial standards state to use `null` for unset |
| `supabase/functions/generate-inspection-html/index.ts` | Update HTML rendering to handle tri-state |
| `supabase/functions/generate-inspection-pdf/index.ts` | Update PDF rendering to handle tri-state |

### Implementation Details

**StandardsTable.tsx** (Desktop view):
```typescript
// YES column - unchanged
<td className="border p-3 text-center">
  <Checkbox
    checked={standardData.has_documentation === true}
    onCheckedChange={(checked) => updateStandard(index, checked ? true : null)}
  />
</td>
// NO column - new checkbox
<td className="border p-3 text-center">
  <Checkbox
    checked={standardData.has_documentation === false}
    onCheckedChange={(checked) => updateStandard(index, checked ? false : null)}
  />
</td>
```

**Mobile view**: Update to show both checkboxes in a row with labels.

---

## Part 2: Bullet Point Formatting for Comments/Required Changes

### Current Behavior
Comments in the "System and Equipment" sections are rendered as plain text in HTML/PDF output:
```html
<td style="font-size: 9pt;">${eq.comments || "—"}</td>
```

### Proposed Solution
Use the existing `parseTextToList()` function to convert multi-line comments into `<ul><li>` bullet lists.

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` | Apply bullet formatting to comments fields |
| `supabase/functions/generate-inspection-pdf/index.ts` | Convert comments to bullet format in jsPDF |

### Implementation Details

**HTML Generation** (`generate-inspection-html/index.ts`):
Create a helper function to format comments as bullets:
```typescript
function formatCommentsAsBullets(comments: string | null): string {
  if (!comments || comments === "—") return "—";
  
  const items = parseTextToList(comments);
  if (items.length <= 1) {
    // Single line - return as-is
    return stripHtmlTags(comments) || "—";
  }
  
  // Multiple lines - render as bullet list
  return `<ul class="comment-bullets" style="list-style: disc; padding-left: 16px; margin: 0;">
    ${items.map(item => `<li style="padding: 2px 0; line-height: 1.4;">${item}</li>`).join('')}
  </ul>`;
}
```

Apply to all table cells rendering comments:
- Equipment table: `equipment_type.comments`
- Operating Systems table: `system.comments`
- Ziplines table: `zipline.comments`
- Standards table: `standard.comments`

**PDF Generation** (`generate-inspection-pdf/index.ts`):
For jsPDF autoTable, format multi-line comments with bullet prefixes:
```typescript
function formatCommentsForPdf(comments: string | null): string {
  if (!comments) return '-';
  const text = stripHtml(comments);
  const lines = text.split('\n').filter(Boolean);
  if (lines.length <= 1) return text;
  return lines.map(line => `• ${line.trim()}`).join('\n');
}
```

---

## Part 3: Cross-Report Global Element Name Memory

### Current Behavior
The `HistoryAutocomplete` component stores element names in **localStorage** with keys like:
- `rope-works-equipment-types`
- `rope-works-operating-system-names`
- `rope-works-zipline-names`

This provides cross-session persistence but is:
- **Device-specific**: Data doesn't sync across devices
- **User-specific** via localStorage: Other users don't benefit

### Proposed Solution
Implement a **global field history table** in the database that stores element names independently of user IDs, allowing all users to share and benefit from previously entered values.

### Database Changes

Create a new table `global_field_history`:
```sql
CREATE TABLE public.global_field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_type TEXT NOT NULL,
  value TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(field_type, value)
);

-- Enable RLS
ALTER TABLE public.global_field_history ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Authenticated users can read global history"
ON public.global_field_history FOR SELECT
TO authenticated
USING (true);

-- All authenticated users can insert/update (upsert pattern)
CREATE POLICY "Authenticated users can insert global history"
ON public.global_field_history FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update global history"
ON public.global_field_history FOR UPDATE
TO authenticated
USING (true);
```

### Component Changes

**Option A: Enhance Existing `HistoryAutocomplete`**
Modify the component to:
1. Load options from **both** localStorage AND the database
2. On value entry, save to **both** localStorage AND database
3. Merge and deduplicate options

**Option B: Create New `GlobalHistoryAutocomplete` Component**
A separate component specifically for fields that should share globally.

Recommendation: **Option A** - Enhance the existing component with a `syncToDatabase` prop.

### Files to Modify

| File | Change |
|------|--------|
| Database migration | Create `global_field_history` table |
| `src/components/HistoryAutocomplete.tsx` | Add database sync capability |
| `src/components/inspection/EquipmentTable.tsx` | Enable global sync |
| `src/components/inspection/OperatingSystemsTable.tsx` | Enable global sync |
| `src/components/inspection/ZiplinesTable.tsx` | Enable global sync |

### Implementation Details

**HistoryAutocomplete.tsx Enhancement**:
```typescript
interface HistoryAutocompleteProps {
  // ... existing props
  syncToDatabase?: boolean; // NEW: Enable global database sync
  fieldType?: string; // NEW: Field type for database storage
}

// Add database fetch on mount
useEffect(() => {
  if (syncToDatabase && fieldType) {
    const fetchGlobalHistory = async () => {
      const { data } = await supabase
        .from('global_field_history')
        .select('value')
        .eq('field_type', fieldType)
        .order('usage_count', { ascending: false })
        .limit(100);
      
      if (data) {
        // Merge with localStorage, deduplicate
        const globalValues = data.map(d => d.value);
        const merged = [...new Set([...historyOptions, ...globalValues])];
        setHistoryOptions(merged.sort((a, b) => a.localeCompare(b)));
      }
    };
    fetchGlobalHistory();
  }
}, [syncToDatabase, fieldType]);

// Add database upsert on value save
useEffect(() => {
  if (syncToDatabase && fieldType && value?.trim()) {
    supabase.from('global_field_history').upsert({
      field_type: fieldType,
      value: value.trim(),
      usage_count: 1,
      last_used_at: new Date().toISOString()
    }, { onConflict: 'field_type,value' });
  }
}, [value, syncToDatabase, fieldType]);
```

**Usage in Tables**:
```typescript
<HistoryAutocomplete
  value={item.equipment_type}
  onChange={(value) => updateEquipment(item, "equipment_type", value)}
  storageKey="rope-works-equipment-types"
  syncToDatabase={true}
  fieldType="equipment_type"
/>
```

---

## Summary of Changes

| Category | File | Description |
|----------|------|-------------|
| **Standards** | `StandardsTable.tsx` | Add checkbox for "NO" column |
| **Standards** | `InspectionForm.tsx` | Handle tri-state initial values |
| **HTML Gen** | `generate-inspection-html/index.ts` | Bullet formatting for comments, tri-state checkboxes |
| **PDF Gen** | `generate-inspection-pdf/index.ts` | Bullet formatting for comments, tri-state checkboxes |
| **Database** | Migration | Create `global_field_history` table |
| **Component** | `HistoryAutocomplete.tsx` | Add `syncToDatabase` and `fieldType` props |
| **Tables** | `EquipmentTable.tsx`, `OperatingSystemsTable.tsx`, `ZiplinesTable.tsx` | Enable global sync for name fields |

---

## Testing Considerations

1. **Standards Checkboxes**: Verify that checking "NO" unchecks "YES" and vice versa; verify neither is checked for new reports
2. **Bullet Formatting**: Test with single-line, multi-line, and empty comments in both HTML view and PDF export
3. **Global Memory**: Test that an element name entered in one report appears as a suggestion in a new report (may require page refresh or new session)
4. **Offline Mode**: Ensure localStorage fallback works when database is unavailable
