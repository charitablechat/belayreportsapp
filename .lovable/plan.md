

# Webhook Investigation Report — Status & Fix

## Trigger Health: CONFIRMED HEALTHY

All **27 triggers active**, `check_trigger_health()` returns `healthy: true`. The trigger restoration from the earlier migration is fully intact. No action needed here.

## Email Webhook (send-notification-email): WORKING

Edge function logs confirm successful delivery:
- "Webhook secret validated" → "Processing email notification" → "Successfully sent to Make.com for 2 recipients"
- The 3-attempt retry logic added earlier is deployed and operational.
- **Remaining issue**: Make.com JSON Parse module mapping (P0, external config — not a code fix).

## Push Notification (send-push-notification): BROKEN — Root Cause Found

**Error** (firing on every report completion):
```
PGRST200: Could not find a relationship between 'user_roles' and 'push_subscriptions' in the schema cache
```

**Root cause**: The edge function uses a PostgREST embedded select (join) from `user_roles` to `push_subscriptions`:
```typescript
.from('user_roles')
.select(`user_id, push_subscriptions(...), notification_preferences(...)`)
```

Both `user_roles` and `push_subscriptions` have a `user_id` column referencing `auth.users`, but there is **no direct foreign key between them**. PostgREST requires a FK path to resolve embedded selects. This query has been silently failing on every report completion.

## Fix: Rewrite send-push-notification to use separate queries

Instead of a single joined query, fetch data in 3 steps:

1. Query `user_roles` for super admins (filtered by role)
2. Query `push_subscriptions` for those user IDs
3. Query `notification_preferences` for those user IDs

This eliminates the PostgREST FK requirement entirely.

### Changes

**1 file**: `supabase/functions/send-push-notification/index.ts`

- Replace the single embedded-select query (lines 91-108) with three separate queries:
  - `user_roles` → get super_admin user_ids
  - `push_subscriptions` → filter by `user_id IN (...)` 
  - `notification_preferences` → filter by `user_id IN (...)`
- Build a map of user_id → { subscriptions, preferences } in TypeScript
- Keep all existing logic (VAPID sending, preference filtering, dead subscription cleanup, notification logging) unchanged
- No schema or trigger changes required

### Additional note on organization_id filtering

The current trigger functions (e.g., `notify_super_admins_inspection_completed`) pass `organizationId` to the push function, which filters `user_roles` by `organization_id`. However, the `send-notification-email` function queries ALL super admins regardless of org. These should be consistent — the push function's org filter will be preserved as-is since it's the more correct (scoped) behavior.

