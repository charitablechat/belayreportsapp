

# Comprehensive Architectural Audit Report

---

## 1. Component Inventory

### Frontend Services
| Component | File(s) | Lines | Purpose |
|-----------|---------|-------|---------|
| Offline Storage Engine | `offline-storage.ts` | 1,995 | IndexedDB v8 with 24 object stores, circuit breaker, `value: any` typing |
| Atomic Sync Manager | `atomic-sync-manager.ts` | 2,134 | 3-step deferred sync for inspections/trainings/assessments |
| Auto Sync Orchestrator | `useAutoSync.tsx` | 588 | Debounced, event-driven sync coordination |
| Service Worker Sync | `sw-sync.js` | 667 | Background sync (vanilla JS, duplicates main-thread logic) |
| Cached Auth | `cached-auth.ts` | 439 | Session caching, LockManager fallback, offline auth |
| Legacy Sync Manager | `sync-manager.ts` | 138 | Deprecated report sync (blocked), active photo sync + **duplicate `online` listener** |
| Report Version Manager | `report-version-manager.ts` | — | Append-only versioning, field-count regression guard |
| Sync Reconciliation | `sync-reconciliation.ts` | — | Server-side orphan detection and child-table cleanup |

### Database Schema (19+ tables)
- **Parent reports**: `inspections`, `trainings`, `daily_assessments`
- **Child tables** (15+): `inspection_systems`, `inspection_ziplines`, `inspection_equipment`, `inspection_standards`, `inspection_summary`, `inspection_photos`, `training_delivery_approaches`, `training_operating_systems`, `training_immediate_attention`, `training_verifiable_items`, `training_systems_in_place`, `training_summary`, `training_photos`, `daily_assessment_*` (6 sub-tables), `daily_assessment_photos`
- **System tables**: `profiles`, `user_roles`, `organizations`, `organization_members`, `notification_preferences`, `push_subscriptions`, `audit_logs`, `webhook_config`, `sync_conflicts`, `report_deleted_items`, `cloud_backups`, `migration_audit`, `user_field_history`, `notifications_log`
- **Functions**: 30+ RPC functions (all SECURITY DEFINER)
- **Triggers**: **0 active** (18 expected — migration not applied)

### Edge Functions (16+)
- Report generation (5): `generate-inspection-pdf/html`, `generate-training-pdf/html`, `generate-daily-assessment-html`
- Notifications (5): `send-notification-email`, `send-push-notification`, `send-report-email`, `send-training-pdf-email`, `send-contact-email`
- Utility (6+): `extract-names`, `get-logo-base64`, `get-vapid-public-key`, `check-overdue-reports`, `og-meta`, `generate-og-image`, `admin-manage-user`, `migrate-*`

### Third-Party Integrations
| Service | Usage | Auth Method |
|---------|-------|-------------|
| Make.com | 2 webhooks (notifications + contact form) | Shared secret / none |
| Resend | Email delivery for report PDFs | API key |
| Web Push (VAPID) | Push notifications | VAPID keypair |

---

## 2. Failure Mode & Effect Analysis (FMEA)

### CRITICAL (Severity 9-10)

| ID | Component | Failure Mode | Effect | Severity |
|----|-----------|-------------|--------|----------|
| **F1** | **Database Triggers** | All 18 triggers are missing. Migration file exists but was never applied. | **All** automated behaviors are dead: notifications, `updated_at` management, audit logging, inspector_id protection, organization auto-linking. This is currently broken in production. | **10** |
| **F2** | **Duplicate `online` Listener** | `sync-manager.ts` line 115 registers a global `window.addEventListener("online")` that fires `Promise.all` on all atomic sync functions — completely bypassing `useAutoSync`'s guards (cooldown, batch limits, `syncInProgressRef`). | Two full sync cycles run simultaneously on every network reconnection, causing transaction conflicts, potential double-inserts, and wasted bandwidth. | **9** |

### HIGH (Severity 6-8)

| ID | Component | Failure Mode | Effect | Severity |
|----|-----------|-------------|--------|----------|
| **F3** | **SW IndexedDB Version** | `sw-sync.js` hardcodes `openDB('rope-works-inspections', 8)`. If main app upgrades to v9, the SW opens a stale schema and silently fails all reads. | Background sync stops working entirely. Currently in sync (both v8), but any future schema migration will break it silently. | **8** |
| **F4** | **Make.com SPOF** | `send-notification-email` calls Make.com with zero retry logic (line 275: single `fetch`). If Make.com is down, the edge function returns 502 and the notification is permanently lost. | Missed email notifications with no recovery path. No failure logging to `notifications_log`. | **7** |
| **F5** | **localStorage Admin Cache** | `cached-super-admin-status` in localStorage is writable via DevTools. Used in 3 files (`AuthenticatedHeader`, `Dashboard`, `cached-auth`) for UI rendering. | Non-admin can see admin UI elements (badge, admin tab). RLS blocks actual data access, so this is UI-only exposure — but it leaks admin route structure. | **7** |
| **F6** | **Photo Sync Unbounded** | `syncPhotos()` in `sync-manager.ts` iterates ALL unuploaded photos with no batch limit. | A backlog of 100+ photos (realistic after multi-day offline fieldwork) blocks the sync thread for minutes, starving report syncs. | **6** |
| **F7** | **IndexedDB `value: any`** | All 20+ IndexedDB stores use `value: any` in the schema definition. | Type mismatches are invisible at compile time. Corrupted records propagate silently through sync and reconciliation. | **6** |

### MEDIUM (Severity 3-5)

| ID | Component | Failure Mode | Effect | Severity |
|----|-----------|-------------|--------|----------|
| **F8** | **Partial Child Data** | If IndexedDB timeout occurs mid-load, some child tables return data while others return `[]`. The empty-array guard only catches "all children empty," not "some missing." | Sync uploads incomplete record. Reconciliation then deletes matching server rows (treating local as truth). | **5** |
| **F9** | **Edge Function Bundle Timeout** | Functions importing heavy dependencies (web-push, resend) can exceed Deno deploy bundle limits. Previously hit `Bundle generation timed out`. | Blocks all edge function deployments until resolved. | **5** |
| **F10** | **`send-contact-email` Unauthenticated** | `verify_jwt = false` with only IP-based rate limiting (3/hr). Bypassable with rotating IPs. | Spam risk. Mitigated by honeypot field but no CAPTCHA. | **4** |
| **F11** | **Trigger Monitoring Absent** | No automated check exists to detect trigger loss. The current outage went undetected until webhook failures were manually noticed. | Silent degradation of all automated database behaviors. | **4** |

---

## 3. Edge Case Stress-Test Scenarios

### High Concurrency
- **Dual-sync race**: User reconnects to network → `sync-manager.ts` global listener fires `Promise.all([syncAllInspectionsAtomic(), ...])` AND `useAutoSync` fires its own sync 1-2s later via its `handleOnline` handler. Two concurrent `syncAllInspectionsAtomic()` calls process the same records.
- **Multi-tab**: Two browser tabs open, both with `useAutoSync` active. Realtime event fires in both → both attempt sync simultaneously. The `syncInProgressRef` is per-component-instance, not cross-tab.

### Data Corruption
- **Partial IndexedDB read**: Circuit breaker trips after loading 3 of 5 child tables. Auto-save writes the partial state to localStorage (safety net). Next sync reads from IndexedDB (now recovered), gets 3 tables + 2 empty. Uploads to server. Reconciliation deletes the 2 missing tables' rows from server.
- **SW schema drift** (future): Main thread upgrades IndexedDB to v9 with new store. SW opens v8, reads stale data, syncs stale data to server, overwrites main-thread changes.

### Network Latency
- **Large inspection on 2G**: 5 child tables × 15s step timeout = 75s minimum for one record. With `MAX_BATCH_SIZE=5` and 5 queued inspections, total sync time: ~375s (6+ minutes). `MAX_SYNC_TIMEOUT` is 300s → timeout kills the last batch mid-transaction.

---

## 4. Production Readiness Assessment

### Security ✅
- **No secrets in frontend code** — confirmed. All API keys are edge-function-only secrets.
- **RLS comprehensive** — owner-priority + super-admin override on all tables.
- **Webhook auth** — database-stored shared secret, validated at runtime.
- **Admin check** — server-side `is_super_admin()` SECURITY DEFINER. localStorage cache is cosmetic only.

### Scalability ⚠️
- Single-user IndexedDB (no cross-device sync without server).
- `MAX_BATCH_SIZE=5` adequate for typical loads. Photo sync unbounded.
- 18 triggers on 3 parent tables: each completion fires 3+ triggers. Safe for individual completions, could cause latency on bulk operations.

### Maintainability ❌
- `atomic-sync-manager.ts` (2,134 lines): 3× duplicated logic for inspections/trainings/assessments.
- `offline-storage.ts` (1,995 lines): Monolithic with `value: any` throughout.
- `sw-sync.js` (667 lines): Vanilla JS duplicating TypeScript sync logic with no shared source of truth.

---

## 5. Prioritized Remediation Plan

### Phase 1: Immediate/Critical (this session)

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| **P0** | F1 | **Apply trigger migration to live database.** The SQL file exists (`20260308164530_*.sql`) but returned 0 rows from `information_schema.triggers`. Must re-execute. | 5 min |
| **P1** | F2 | **Remove duplicate `online` listener** from `sync-manager.ts` lines 114-138. `useAutoSync` already handles reconnection with proper guards. The photo sync call can be moved into `useAutoSync`. | 15 min |
| **P2** | F11 | **Add trigger health-check RPC** — a function that queries `information_schema.triggers` and returns the count. Call it on admin dashboard load to surface trigger loss immediately. | 30 min |

### Phase 2: Performance/Scalability (1-2 weeks)

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| **P3** | F6 | Add `MAX_PHOTO_BATCH_SIZE = 10` to `syncPhotos()`. Return remaining count for accelerated re-sync. | 1 hr |
| **P4** | F4 | Add 3-attempt exponential backoff to Make.com webhook calls in `send-notification-email`. Log failures to `notifications_log`. | 2 hr |
| **P5** | F3 | Extract `DB_VERSION` into a shared constant. SW reads from main thread via `postMessage` on activation, or reads a `/public/db-config.json` file. | 2-3 hr |
| **P6** | F8 | Enhance empty-array guard: if server has N rows for a specific child table but local has 0 for that table (while other tables have data), flag as suspicious partial read and skip reconciliation for that table. | 2-3 hr |

### Phase 3: Technical Debt/Refactoring (1-2 months)

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| **P7** | F7 | Replace `value: any` with concrete interfaces for all 20+ IndexedDB stores. | 1-2 days |
| **P8** | — | Refactor `atomic-sync-manager.ts` into a generic `syncReportAtomic<T>()`. Eliminate 3× duplication. Target: 2,134 → ~800 lines. | 2-3 days |
| **P9** | — | Generate `sw-sync.js` from TypeScript source, or migrate to Workbox with shared validation logic. | 3-5 days |
| **P10** | — | Consolidate `generate-*-html` edge functions into a single parameterized function using the shared `report-layout.ts`. | 1-2 days |

---

### System Scorecard

| Category | Score | Key Factor |
|----------|-------|------------|
| **Data Integrity** | 8/10 | Multi-layer safeguards. Gap: partial child detection (F8) |
| **Security** | 8.5/10 | No frontend secrets, comprehensive RLS. Minor: localStorage admin cache |
| **Offline Resilience** | 9/10 | Circuit breaker, triple-copy backup, WAL. Gap: SW version drift |
| **Notification Pipeline** | 3/10 | **All triggers missing.** Make.com has no retry. Currently non-functional. |
| **Maintainability** | 5/10 | Large monolithic files, `any` typing, duplicated logic |
| **Scalability** | 7/10 | Adequate batching. Unbounded photo sync is the main gap. |

---

**Recommended immediate action**: Re-apply the trigger migration (P0) and remove the duplicate online listener (P1). These two changes fix the most severe production issues with minimal risk.

