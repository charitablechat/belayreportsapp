

## Hybrid Select-then-Edit for Equipment Ropes Type Field

### Summary

After a user picks one of the 4 rope type options from the dropdown, the field transitions into an editable text input pre-filled with the selected value. The user can then append or modify text freely (e.g., "Dynamic Kernmantle - 11mm, replaced Jan 2026"). The final string in `equipment_type` is what gets persisted and synced.

### How It Works

When `typeOptions` is provided and the current value is empty/unset, render the existing `Select` dropdown. Once a value is selected (or if the item already has a non-empty `equipment_type`), render an `Input` text field instead, pre-filled with the value. A small button allows reverting back to the dropdown if the user wants to re-select from scratch.

### Data Integrity

The `equipment_type` field remains a plain string. The only change is **how** the UI populates it. The value stored in IndexedDB and synced to the database is identical to what appears in the input. No schema changes, no new columns, no impact on reconciliation logic. The delete-and-replace sync pattern operates on `item.id`, not on the content of `equipment_type`, so custom text values are preserved exactly as entered.

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/EquipmentTable.tsx` | Replace the `typeOptions` Select rendering (both desktop and mobile) with a hybrid component: show Select when value is empty, show editable Input when value is set. Add a small "re-select" button to clear the value and return to dropdown mode. |

### Technical Detail

In `EquipmentTable.tsx`, for both the desktop table cell and the mobile card, the current `typeOptions` branch:

```typescript
{typeOptions ? (
  <Select value={currentVal} onValueChange={...}>
    ...
  </Select>
) : (
  <GlobalAutocomplete ... />
)}
```

Becomes:

```typescript
{typeOptions ? (
  currentVal.trim() !== "" ? (
    // Post-selection: editable text input with re-select option
    <div className="flex items-center gap-1">
      <Input
        value={currentVal}
        onChange={(e) => updateEquipment(item, "equipment_type", e.target.value)}
        onBlur={onImmediateSave}
        onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
        className="border-0 bg-transparent flex-1"
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 shrink-0"
        onClick={() => { updateEquipment(item, "equipment_type", ""); onImmediateSave?.(); }}
        title="Re-select type"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  ) : (
    // Initial state: dropdown selection
    <Select onValueChange={(v) => { updateEquipment(item, "equipment_type", v); onImmediateSave?.(); }}>
      <SelectTrigger className="ring-2 ring-destructive ...">
        <SelectValue placeholder="Select type" />
      </SelectTrigger>
      <SelectContent>
        {typeOptions.map((opt) => (
          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
) : (
  <GlobalAutocomplete ... />
)}
```

The legacy value handling (amber ring for values not in the current options list) is no longer needed since any string is valid once the field is in text-input mode. Legacy values will simply appear in the editable input.

Mobile view receives the identical logic, adapted to the card layout styling.
