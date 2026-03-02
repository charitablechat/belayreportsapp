

## Remove "ACCT" from Retirement Procedure Line

### What's Changing
The final line of the generated inspection HTML report contains:

> "...must be maintained in accordance with **ACCT** record-keeping requirements."

This will be changed to:

> "...must be maintained in accordance with record-keeping requirements."

### File Changed

| File | Line | Change |
|------|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` | 2579 | Remove `ACCT ` from the sentence |

The updated sentence will read:

```
...must be maintained in accordance with record-keeping requirements.
```

One word removed. No other text, formatting, or content is altered.

