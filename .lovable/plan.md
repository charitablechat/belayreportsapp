

# Fix Version Info Modal Date Format and Timezone

## Issue Summary

The current version info modal displays:
- **Date**: `2024-05-20` (YYYY-MM-DD format with placeholder date)
- **Timestamp**: `2024-05-20T14:30:00Z` (UTC timezone)

The user wants:
- **Date**: `MM-DD-YYYY` format with today's actual deployment date
- **Timestamp**: US Central Time instead of UTC

## Changes Required

### File: `vite.config.ts`

Update the build constants to reflect today's deployment with the correct formats:

**Before:**
```typescript
const BUILD_DATE = "2024-05-20";
const BUILD_TIMESTAMP = "2024-05-20T14:30:00Z";
```

**After:**
```typescript
const BUILD_DATE = "02-04-2026";  // MM-DD-YYYY format
const BUILD_TIMESTAMP = "02-04-2026 at 09:30 AM CST";  // Central Time, human-readable
```

### Version Update

Since this is a deployment change, increment the version:
- **From:** `v2.2.20`
- **To:** `v2.2.30`

## Technical Notes

- The date and timestamp are hardcoded in `vite.config.ts` and injected at build time
- Each deployment should update these values to reflect the actual push time
- Using "CST" (Central Standard Time) or "CDT" (Central Daylight Time) depending on time of year - February is CST
- The human-readable timestamp format (`MM-DD-YYYY at HH:MM AM/PM CST`) is clearer for users

## Files to Modify

| File | Changes |
|------|---------|
| `vite.config.ts` | Update `BUILD_DATE` to `02-04-2026` format, update `BUILD_TIMESTAMP` to Central Time with readable format, increment `APP_VERSION` to `2.2.30` |

