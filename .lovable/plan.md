

# Reset Avg Completion Time Metric

## Overview
The "Avg Completion Time" metric is computed dynamically from the `inspections` table (no stored cumulative value). To implement a "reset", we store a cutoff timestamp in a new `admin_settings` table. The query then ignores all data completed before that timestamp. A reset button in the dashboard lets super admins trigger this.

## Database

### New table: `admin_settings`
A simple key-value config table for admin-level settings, protected by super-admin-only RLS.

```sql
CREATE TABLE admin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);
-- RLS: super_admin only for all operations
```

Seed it with: `INSERT INTO admin_settings (key, value) VALUES ('avg_completion_time_reset_at', '1970-01-01T00:00:00Z');`

## Files to Modify

### 1. `src/pages/SuperAdminDashboard.tsx`
- Add a new query to fetch `avg_completion_time_reset_at` from `admin_settings`.
- Update the `avgCompletionTimeData` query to use `MAX(resetTimestamp, thirtyDaysAgo)` as the lower bound filter, so it ignores all legacy data before the reset.
- Add a "Reset Metric" button (with confirmation dialog) on the Avg Completion Time stat card. On confirm, upsert the `admin_settings` row with `NOW()` and invalidate the query.
- Style the reset button and confirmation with the Retro-Tech Terminal aesthetic:
  - Dark background `bg-[#0a0a0a]`, green accent `text-[#00ff41]`, `font-mono` for values.
  - CRT scanline overlay using the existing `.crt-scanlines` class.
  - The metric value uses `font-mono tabular-nums` for the numeric display.

### 2. `src/components/admin/StatCard.tsx`
- Add an optional `actions` prop (ReactNode) rendered below the metric value, allowing the parent to inject a reset button without breaking the generic card API.

### 3. `src/index.css`
- No new classes needed; existing `.crt-scanlines`, `.glass-card`, and `.brutalist-metric` cover the aesthetic. The terminal styling is applied inline via Tailwind on the specific card.

## Technical Details

- **Query logic**: The reset timestamp acts as a floor. `gte("updated_at", Math.max(resetAt, thirtyDaysAgo))` ensures only post-reset, recent data is included.
- **No data deletion**: Legacy records remain intact in the database. The reset is purely a filter adjustment.
- **Security**: The `admin_settings` table uses restrictive RLS (super_admin only). No secrets or API keys are involved.
- **UI feedback**: After reset, a success toast confirms the action. The metric immediately shows "0h" until new completions accumulate.
- **Retro-Tech badge**: The stat card for Avg Completion Time gets a small `RESET` badge with timestamp showing when the last reset occurred, styled with `font-mono text-[#00ff41] bg-[#0a0a0a]`.

## Files Summary
- **New migration**: Create `admin_settings` table + seed row + RLS policies
- **Modify**: `src/pages/SuperAdminDashboard.tsx` (reset button, updated query filter)
- **Modify**: `src/components/admin/StatCard.tsx` (optional actions slot)

