

## Change "Provisions" to "Pass with Provisions" in Report Output

### What's Changing

In the generated inspection HTML report, the result checkbox display currently renders three options as:
- Pass
- **Provisions**
- Fail

The label "Provisions" needs to be changed to "**Pass with Provisions**" to match the intended terminology used elsewhere in the report (e.g., the key/legend section already says "Pass with Provisions").

### Scope

This is a single-line change in one file. The PDF generator (`generate-inspection-pdf`) does not use this pattern -- only the HTML generator does.

### File Changed

| File | Line | Change |
|------|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` | 396 | Replace `Provisions` with `Pass with Provisions` in the checkbox label |

The updated line will read:
```
${provisions} Pass with Provisions
```

This applies to all equipment tables, operating systems tables, standards tables, and zipline tables since they all use the same `formatResultCheckbox` helper function.

