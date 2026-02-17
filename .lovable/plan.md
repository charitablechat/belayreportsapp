

# Remove N/A from Equipment Result Dropdown

## Summary

The Equipment section's result dropdown currently shows "N/A" because the `ResultSelect` component is called with `includeNA` prop set to `true`. Removing this prop (which defaults to `false`) will hide the N/A option while keeping all other choices (Pass, Pass w/Provisions, Fail) intact.

## Changes

### File: `src/components/inspection/EquipmentTable.tsx`

Two instances of `includeNA` need to be removed:

1. **Desktop table view (line 267):** Remove `includeNA` from the `ResultSelect` usage
2. **Mobile card view (line 440):** Remove `includeNA` from the `ResultSelect` usage

No validation or default-value logic is affected because:
- New equipment items default to `result: "pass"`, not "na"
- The `ResultSelect` component already handles unknown values gracefully via its default switch case
- Existing records with "na" stored will display the raw value but users can re-select a valid option

## No other files are modified

The `ResultSelect` component itself remains unchanged -- its `includeNA` prop and N/A rendering logic stay in place for any other form sections that may use it.

