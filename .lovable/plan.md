

## Add Distinct `daily_assessment_completed` Notification Type

Only daily assessments need fixing — trainings already use their own `training_completed` type.

### Changes

**1. Database Migration** — Replace `'inspection_completed'` with `'daily_assessment_completed'` in both daily assessment trigger functions:
- `notify_super_admins_daily_assessment_completed()` — push notification trigger
- `notify_super_admins_daily_assessment_email()` — email notification trigger

**2. Edge Function: `send-push-notification/index.ts`**
- Add `'daily_assessment_completed'` to the validation whitelist (line 25)
- Add preference check for the new type in the notification send logic

**3. Edge Function: `send-notification-email/index.ts`**
- Add `'daily_assessment_completed'` to the TypeScript type union (line 12)
- Add email HTML generation block for daily assessments (link to assessment, show site/inspector details)

**4. Update `check_trigger_health()` expected count** if the migration recreates triggers (verify count stays at 27 since we're replacing, not adding).

### Result
Make.com will receive three distinct `notificationType` values: `inspection_completed`, `training_completed`, and `daily_assessment_completed`, enabling separate routing for each.

