

## Temporarily Disable Equipment Auto-Populate on Import

### What changes
**One file: `src/pages/NewInspection.tsx`**

On line 246, where imported child data is stored in state, change:
```typescript
equipment: data.equipment || [],
```
to:
```typescript
equipment: [], // Temporarily disabled — keep AI extraction but skip auto-populate
```

This means:
- The edge function still extracts equipment from the document (no backend changes)
- The extracted equipment data is simply discarded client-side before it reaches state
- The `insertChildData` function's equipment block (lines 336-363) remains intact but never fires because `childData.equipment` will always be empty
- The success toast (lines 255-260) will no longer count equipment items since none are stored

All other imported data (systems, ziplines, standards, summary, form fields) remains fully operational. Re-enabling is a one-line revert.

