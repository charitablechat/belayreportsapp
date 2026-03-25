

## Fix: Typing Lag in Report Forms

### Root Cause

Every keystroke in any table cell triggers this cascade:

1. `updateEquipment(item, field, value)` calls `onUpdate(prev => prev.map(...))` → creates a **new array** → `setEquipment(newArray)`
2. A `useEffect` watches `[systems, ziplines, equipment, standards, summary]` (line 554) — fires on **every keystroke**
3. That effect calls `setHasUnsavedChanges(true)` (another state update → another render)
4. The entire `InspectionForm` (2957 lines) re-renders, which re-renders **all** child table components
5. Each table filters and maps its items again, re-rendering every row

With 25+ equipment items across multiple tables, this means hundreds of component re-renders per keystroke.

### Solution: Debounce State Propagation + Memoize Child Components

**1. `src/components/inspection/EquipmentTable.tsx` — Use local state for active input fields**

Add a local input buffer pattern: when a user is typing in an `Input` or `LazyRichTextEditor`, store the value locally and only propagate to parent (`onUpdate`) on blur or after a 300ms debounce. This prevents the parent from re-rendering on every keystroke.

Create a small `DebouncedInput` wrapper component used inside the table rows:
```typescript
const DebouncedInput = memo(({ value, onChange, onBlur, ...props }) => {
  const [local, setLocal] = useState(value);
  const timeoutRef = useRef<NodeJS.Timeout>();
  
  useEffect(() => { setLocal(value); }, [value]);
  
  const handleChange = (e) => {
    setLocal(e.target.value);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onChange(e.target.value), 300);
  };
  
  return <Input value={local} onChange={handleChange} onBlur={() => onChange(local)} {...props} />;
});
```

Replace all `<Input value={item.field} onChange={e => updateEquipment(item, 'field', e.target.value)} />` calls with `<DebouncedInput>`.

**2. Apply same pattern to `OperatingSystemsTable.tsx` and `ZiplinesTable.tsx`**

All three table components have the same issue. Apply the `DebouncedInput` pattern to each.

**3. `src/pages/InspectionForm.tsx` — Remove `hasUnsavedChanges` state churn from the useEffect**

The watcher on line 554 calls `setHasUnsavedChanges(true)` on every data change, which triggers an extra re-render. Change it to use a ref instead of state for tracking unsaved status during auto-save debounce, and only set the state once (not on every keystroke).

### Files
| File | Change |
|------|--------|
| `src/components/inspection/EquipmentTable.tsx` | Add `DebouncedInput` component; use it for all text inputs in rows |
| `src/components/inspection/OperatingSystemsTable.tsx` | Same `DebouncedInput` pattern |
| `src/components/inspection/ZiplinesTable.tsx` | Same `DebouncedInput` pattern |
| `src/pages/InspectionForm.tsx` | Use ref for `hasUnsavedChanges` tracking in auto-save watcher to avoid extra re-renders |

