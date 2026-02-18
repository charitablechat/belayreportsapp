

# Fix Duplicate "Synced" Badges on Report Cards

## Problem

Two independent "Synced" badges render on inspection cards because of overlapping logic in two different components:

- **ReportCard.tsx** (line 222): Universal badge -- green text, green border, always shown when `synced_at` exists
- **Dashboard.tsx getStatusBadge** (line 845): Inspection-specific badge -- default outline style (black text), also shown when `synced_at` exists

Both check the same `synced_at` field, so synced inspections display two badges side by side.

## Fix

Remove the duplicate "Synced" badge from the `getStatusBadge` function in `Dashboard.tsx`. The universal green badge in `ReportCard.tsx` already communicates sync status clearly with better styling (green color, consistent across all report types). The `getStatusBadge` function will retain only its unique capabilities: the "Syncing" animation badge and the unsynced photos count badge.

## Technical Details

### File: `src/pages/Dashboard.tsx`

Remove lines 844-858 (the "Synced badge" block inside `getStatusBadge`). This eliminates the black/outline duplicate while keeping:
- The "Syncing" spinner badge (shown during active sync)
- The unsynced photos count badge

### No other files change

- `ReportCard.tsx` stays as-is -- its green "Synced" badge becomes the single source of truth
- No data, schema, or sync logic changes -- purely a UI deduplication

