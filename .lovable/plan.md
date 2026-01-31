

# Plan: Add N/A and Unknown Options to Previous Inspection Date Field

## Overview
Modify the "Previous Inspection Date" input in `NewInspection.tsx` to support three selection modes:
1. **Date Picker** - Standard calendar selection for known dates
2. **N/A** - For courses that have never been inspected
3. **Unknown** - For courses where the inspection date exists but is unrecorded

## Technical Approach

### Storage Strategy
The database field `previous_inspection_date` is already `string | null`. We'll store:
- **Date**: `"2024-01-15"` (ISO date string)
- **N/A**: `"N/A"` (literal string)
- **Unknown**: `"Unknown"` (literal string)
- **Not Set**: `null` or `""`

### UI Design
Replace the simple date input with a hybrid control that shows:
- A styled button/trigger that displays the current selection
- A popover containing:
  - Two quick-select buttons for "N/A" and "Unknown"
  - A divider
  - A full calendar for date selection

```
┌─────────────────────────────────────────────┐
│  📅  Select previous inspection date...   ▼ │
└─────────────────────────────────────────────┘
          │
          ▼ (on click, popover opens)
┌─────────────────────────────────────────────┐
│  ┌─────────────────┐ ┌────────────────────┐ │
│  │      N/A        │ │     Unknown        │ │
│  │ Never inspected │ │  Date not recorded │ │
│  └─────────────────┘ └────────────────────┘ │
│  ─────────────────────────────────────────  │
│           [    January 2026    ]            │
│  Su  Mo  Tu  We  Th  Fr  Sa                 │
│  ...calendar grid...                        │
└─────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Create New Component
Create `src/components/PreviousInspectionDatePicker.tsx`

```typescript
interface PreviousInspectionDatePickerProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}
```

**Component Features:**
- Accepts and returns string values: date string, "N/A", "Unknown", or empty
- Uses Popover + Calendar from existing shadcn components
- Displays appropriate icon and text based on current selection:
  - Calendar icon + formatted date for dates
  - Ban icon + "N/A - Never inspected" for N/A
  - HelpCircle icon + "Unknown" for Unknown
  - Calendar icon + placeholder for empty

### Step 2: Update NewInspection.tsx
Replace the current date input (lines 321-328) with the new component:

**Before:**
```tsx
<Input
  id="previous_inspection_date"
  type="date"
  value={formData.previous_inspection_date || ""}
  onChange={(e) => setFormData(prev => ({ ...prev, previous_inspection_date: e.target.value || "" }))}
/>
```

**After:**
```tsx
<PreviousInspectionDatePicker
  value={formData.previous_inspection_date}
  onChange={(value) => setFormData(prev => ({ ...prev, previous_inspection_date: value }))}
  disabled={loading}
/>
```

### Step 3: Update InspectionHeader.tsx
Apply the same component to the existing inspection form (line 115) for consistency when editing:

**Before:**
```tsx
{renderField("Prev. Inspection Date", "previous_inspection_date", inspection?.previous_inspection_date, "date")}
```

**After:**
```tsx
<div>
  <Label className="text-sm text-muted-foreground">Prev. Inspection Date</Label>
  <PreviousInspectionDatePicker
    value={inspection?.previous_inspection_date}
    onChange={(value) => {
      onUpdate("previous_inspection_date", value);
      onImmediateSave?.();
    }}
    disabled={isReadOnly}
  />
</div>
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/PreviousInspectionDatePicker.tsx` | **Create** | New hybrid date picker component |
| `src/pages/NewInspection.tsx` | **Modify** | Replace date input with new component (lines 321-328) |
| `src/components/inspection/InspectionHeader.tsx` | **Modify** | Replace date field with new component (line 115) |

---

## Component Implementation Details

### PreviousInspectionDatePicker.tsx

```typescript
import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Ban, HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseLocalDate } from "@/lib/date-utils";

// Special values stored in database
const SPECIAL_VALUES = {
  NA: "N/A",
  UNKNOWN: "Unknown",
} as const;

interface Props {
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function PreviousInspectionDatePicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);

  // Determine what type of value we have
  const isNA = value === SPECIAL_VALUES.NA;
  const isUnknown = value === SPECIAL_VALUES.UNKNOWN;
  const isDate = value && !isNA && !isUnknown;
  const parsedDate = isDate ? parseLocalDate(value) : undefined;

  const handleSelect = (selection: string) => {
    onChange(selection);
    setOpen(false);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      // Format as YYYY-MM-DD for database storage
      const formatted = format(date, "yyyy-MM-dd");
      onChange(formatted);
      setOpen(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  // Determine display text and icon
  const getDisplayContent = () => {
    if (isNA) {
      return { icon: Ban, text: "N/A - Never inspected", className: "text-muted-foreground" };
    }
    if (isUnknown) {
      return { icon: HelpCircle, text: "Unknown", className: "text-muted-foreground" };
    }
    if (parsedDate) {
      return { icon: CalendarIcon, text: format(parsedDate, "PPP"), className: "" };
    }
    return { icon: CalendarIcon, text: "Select date...", className: "text-muted-foreground" };
  };

  const display = getDisplayContent();
  const Icon = display.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            display.className
          )}
        >
          <Icon className="mr-2 h-4 w-4" />
          <span className="flex-1">{display.text}</span>
          {value && !disabled && (
            <X 
              className="h-4 w-4 opacity-50 hover:opacity-100" 
              onClick={handleClear}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {/* Quick select options */}
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={isNA ? "default" : "outline"}
              size="sm"
              className="justify-start"
              onClick={() => handleSelect(SPECIAL_VALUES.NA)}
            >
              <Ban className="mr-2 h-4 w-4" />
              <div className="text-left">
                <div className="font-medium">N/A</div>
                <div className="text-xs opacity-70">Never inspected</div>
              </div>
            </Button>
            <Button
              variant={isUnknown ? "default" : "outline"}
              size="sm"
              className="justify-start"
              onClick={() => handleSelect(SPECIAL_VALUES.UNKNOWN)}
            >
              <HelpCircle className="mr-2 h-4 w-4" />
              <div className="text-left">
                <div className="font-medium">Unknown</div>
                <div className="text-xs opacity-70">Date not recorded</div>
              </div>
            </Button>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-popover px-2 text-muted-foreground">or select date</span>
            </div>
          </div>
        </div>
        <Calendar
          mode="single"
          selected={parsedDate}
          onSelect={handleDateSelect}
          initialFocus
          className="pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
```

---

## Visual Summary

| Selection | Display | Stored Value |
|-----------|---------|--------------|
| Empty | "Select date..." with calendar icon | `""` or `null` |
| N/A | "N/A - Never inspected" with ban icon | `"N/A"` |
| Unknown | "Unknown" with help icon | `"Unknown"` |
| Date | "January 15, 2024" with calendar icon | `"2024-01-15"` |

---

## Testing Checklist
- Create new inspection with no previous date selected
- Create new inspection with N/A selected
- Create new inspection with Unknown selected  
- Create new inspection with a specific date selected
- Clear a selected value using the X button
- Verify the value persists after saving and reloading
- Test on mobile devices for proper popover positioning

