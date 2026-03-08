

# Trigger Restoration Confirmation + Architectural Audit

---

## Part 1: Trigger Restoration — CONFIRMED

All 27 triggers are active in the live database:

| Table | Triggers | Count |
|-------|----------|-------|
| `daily_assessments` | auto_link_org, notify_email, notify_push, prevent_inspector_change, set_updated_at | 5 |
| `inspections` | audit_completion, auto_link_org, notify_email, notify_push, prevent_inspector_change, set_updated_at | 6 |
| `trainings` | auto_link_org, notify_email, notify_push, prevent_inspector_change, set_updated_at | 5 |
| `user_roles` | audit_user_role_changes | 1 |
| `notifications_log` | audit_notification_send | 1 |
| `sync_conflicts` | trigger_sync_conflict_notification | 1 |
| `profiles` | add_name_to_history, on_profile_updated | 2 |
| `inspection_reports` | inspection_report_version | 1 |
| `training_reports` | training_report_version | 1 |
| `form_*` (4 tables) | update_*_updated_at | 4 |
| **Total** | | **27** |

### Steps Taken
1. Migration `20260308165236` — initial trigger creation (failed to apply)
2. Migration `20260308170901` — DROP IF EXISTS + CREATE (applied successfully, created duplicates)
3. Migration `20260308171130` — Dropped 21 duplicate triggers
4. Migration `20260308171145` — Updated `check_trigger_health()` to use `pg_trigger` (expected: 27)

---

## Part 2: Make.com "Empty Payload" Root Cause

**The triggers ARE firing. The edge function IS posting. Make.com IS receiving the webhook.** The failure is in Make.com's scenario configuration.

From the uploaded screenshot:
- Webhook module: green check, "The operation was completed"
- JSON Parse module: red error, *"Missing value of required parameter 'json'"*
- Module inspector shows: **Mappings: Empty**

**Fix (Make.com UI, not code):** In the JSON Parse module, set the "JSON string" parameter to map from the webhook's body output (typically `{{1.body}}` or the webhook's output bundle). No code change needed.

---

## Part 3: Comprehensive Architectural Audit

### 3.1 Component Map

**Frontend Services**
| Component | File | Purpose |
|-----------|------|---------|
| Offline Storage | `offline-storage.ts` (1,995 lines) | IndexedDB v8, 24 stores, circuit breaker |
| Atomic Sync | `atomic-sync-manager.ts` (2,134 lines) | 3-step deferred sync for all report types |
| Auto Sync | `useAutoSync.tsx` (588 lines) | Debounced event-driven sync orchestration |
| SW Sync | `sw-sync.js` (667 lines) | Background sync (vanilla JS) |
| Cached Auth | `cached-auth.ts` (439 lines) | Session caching, offline auth |
| Sync Manager | `sync-manager.ts` | Photo sync (batched to 10), legacy report sync disabled |

**Database (19+ tables)**
- Parent reports: `inspections`, `trainings`, `daily_assessments`
- Child tables (15+): `inspection_systems/ziplines/equipment/standards/summary/photos`, `training_delivery_approaches/operating_systems/immediate_attention/verifiable_items/systems_in_place/summary/photos`, `daily_assessment_*` (6 sub-tables + photos)
- System: `profiles`, `user_roles`, `organizations`, `organization_members`, `notification_preferences`, `push_subscriptions`, `audit_logs`, `webhook_config`, `sync_conflicts`, `cloud_backups`, `migration_audit`, `user_field_history`, `notifications_log`
- 30+ RPC functions (all SECURITY DEFINER)
- 27 active triggers

**Edge Functions (16+)**
- Report generation: `generate-inspection-pdf/html`, `generate-training-pdf/html`, `generate-daily-assessment-html`
- Notifications: `send-notification-email`, `send-push-notification`, `send-report-email`, `send-training-pdf-email`, `send-contact-email`
- Utility: `extract-names`, `get-logo-base64`, `get-vapid-public-key`, `check-overdue-reports`, `og-meta`, `generate-og-image`, `admin-manage-user`

**Third-Party Integrations**
| Service | Secret | Usage |
|---------|--------|-------|
| Make.com (reports) | `MAKE_WEBHOOK_URL` | Completed report email notifications |
| Make.com (contact) | `MAKE_CONTACT_WEBHOOK_URL` | Contact form submissions |
| Resend | `RESEND_API_KEY` | Direct PDF email delivery |
| Web Push | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push notifications |

### 3.2 Security Confirmation

**No secrets in frontend code** — confirmed. All 12 secrets (`MAKE_WEBHOOK_URL`, `MAKE_CONTACT_WEBHOOK_URL`, `RESEND_API_KEY`, `VAPID_*`, `WEBHOOK_SECRET`, etc.) are edge-function-only via `Deno.env.get()`. The frontend `.env` contains only the publishable anon key and project URL.

### 3.3 Failure Mode & Effects Analysis (FMEA)

| ID | Component | Failure Mode | Effect | Sev | Detection | Mitigation |
|----|-----------|-------------|--------|-----|-----------|------------|
| **F1** | Make.com JSON Parse | Module unmapped — webhook body not passed to parser | All report completion emails silently dropped | **9** | Make.com execution log (manual) | **Fix mapping in Make.com UI** (immediate) |
| **F2** | Make.com availability | Single `fetch()` with no retry in `send-notification-email` | Notification permanently lost on transient failure | **7** | Edge function logs | Add 3-attempt exponential backoff |
| **F3** | SW IndexedDB version | `sw-sync.js` hardcodes v8; main app upgrade to v9 breaks SW | Background sync silently stops | **8** | None (silent) | Extract `DB_VERSION` to shared config |
| **F4** | Dual-sync on reconnect | (Previously fixed) `sync-manager.ts` had duplicate `online` listener | Two concurrent syncs causing transaction conflicts | **9** | Console errors | **Already remediated** — listener removed |
| **F5** | Photo sync volume | Batch limited to 10, but no progress indicator for large backlogs | User unaware of 50+ photo backlog syncing | **4** | `syncPhotos()` return value | Add UI indicator for remaining photos |
| **F6** | Partial IndexedDB read | Circuit breaker trips mid-load; some child tables return `[]` | Sync uploads incomplete record; reconciliation deletes server rows | **6** | Audit logs | Enhanced guard: skip reconciliation when `localCount < serverCount * 0.5` |
| **F7** | `send-contact-email` unauthenticated | `verify_jwt = false` with IP rate-limit only | Spam risk (mitigated by honeypot) | **4** | Rate limit logs | Consider CAPTCHA for high-volume |
| **F8** | Trigger monitoring | `check_trigger_health()` only runs on admin dashboard load | Trigger loss between admin visits goes undetected | **4** | Manual | Add pg_cron scheduled health check |

### 3.4 Production Bottlenecks

1. **Large inspection sync on 2G**: 5 child tables × 15s timeout = 75s per record. 5 queued records = 375s, exceeding `MAX_SYNC_TIMEOUT` (300s).
2. **Photo backlog**: After multi-day offline fieldwork, 100+ photos at 10/batch = 10+ sync cycles to clear.
3. **Trigger cascade on completion**: Each report completion fires 5 triggers (updated_at, auto_link_org, audit, push notification, email notification). Acceptable for single completions; could cause latency if bulk-completing reports.

### 3.5 Recommended Actions

| Priority | Action | Type |
|----------|--------|------|
| **P0** | Fix Make.com JSON Parse module mapping (webhook body → json parameter) | Make.com config |
| **P1** | Add retry logic to Make.com webhook calls in `send-notification-email` | Code change |
| **P2** | Extract `DB_VERSION` constant shared between main thread and SW | Code change |
| **P3** | Add partial-read guard enhancement to reconciliation | Code change |
| **P4** | Add pg_cron trigger health check (weekly) | Migration |

