

## Fix: Update MAKE_WEBHOOK_URL Secret to Correct Reports Webhook

### Problem
The `MAKE_WEBHOOK_URL` secret (used by `send-notification-email` for all 3 report completions) is currently set to the **Contact Developer** Make.com webhook URL. This causes training/inspection/daily assessment completions to arrive in the wrong Make.com scenario.

### Evidence
- Code is correct: `send-notification-email` uses `MAKE_WEBHOOK_URL`, `send-contact-email` uses `MAKE_CONTACT_WEBHOOK_URL` — fully isolated
- All 6 triggers (push + email for each of 3 report types) correctly call the right edge functions
- The issue is purely a **misconfigured secret value**

### Fix (Single Step)
Update the `MAKE_WEBHOOK_URL` secret to: `https://hook.us2.make.com/3rj4hu9v5uapnxyu34dcgadmm67wie7x`

No code changes needed. No migration needed. Just the secret value update.

### After the Fix
All three report types will route to the correct Make.com scenario:
- `inspection_completed` → reports webhook
- `training_completed` → reports webhook  
- `daily_assessment_completed` → reports webhook

The Contact Developer form will continue using its own separate `MAKE_CONTACT_WEBHOOK_URL` secret, unaffected.

