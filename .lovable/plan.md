

# Swap Column Order: Element Name before Operating System

## What Changes

The Operating Systems table in generated HTML/PDF reports currently shows columns as: **System Name | Element Name | Result | Comments**. This will be reordered to: **Element Name | System Name | Result | Comments**.

## Scope

**File:** `supabase/functions/generate-inspection-html/index.ts`

Three locations need updating:

### 1. CSS Column Width Comments (lines 813-816)
Swap the comments so column 1 becomes "Element Name" (18%) and column 2 becomes "System Type" (18%). The widths stay the same since both are 18%.

### 2. Combined Systems+Ziplines Page (lines 1843-1860)
- Swap `<th>` order: "Element Name" first, then "System Name"
- Swap `<td>` order: `sys.name` first, then `sys.system_name`

### 3. Separate Systems Page (lines 1964-1981)
- Same swap as above for the standalone systems page layout

### Technical Detail

**Before (both table instances):**
```
<th>System Name</th>
<th>Element Name</th>
...
<td><strong>${sys.system_name}</strong></td>
<td>${sys.name || "N/A"}</td>
```

**After:**
```
<th>Element Name</th>
<th>System Name</th>
...
<td>${sys.name || "N/A"}</td>
<td><strong>${sys.system_name}</strong></td>
```

No other files, data structures, or logic are affected. The edge function will be redeployed automatically.
