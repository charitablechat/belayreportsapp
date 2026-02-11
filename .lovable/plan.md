
# Remove Snowfall Animation

## Change

Remove the `<Snowfall />` component from `src/pages/Dashboard.tsx` (line 791) and its import (line 43). The snowflake animation isn't working and is no longer needed.

## Files

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Remove `Snowfall` import (line 43) and `<Snowfall />` usage (lines 790-791) |

The `src/components/christmas/Snowfall.tsx` file itself can optionally be deleted as well since it will no longer be referenced.
