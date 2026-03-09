

# Comprehensive Architectural Audit Report

---

## 1. Component Mapping

### Core Services
| Layer | Component | Technology |
|-------|-----------|------------|
| Frontend | SPA (React 18 + Vite + TypeScript) | PWA with offline-first architecture |
| Local Storage | IndexedDB v8 (`rope-works-inspections`) | 24 object stores for 3 report types + children |
| Backup Layer | localStorage snapshot ledger + report_versions | Append-only versioning |
| Auth | Supabase Auth with cached-auth layer | Session caching, offline fallback, LockManager recovery |
| Database | PostgreSQL via Supabase (35+ tables) | RLS with 192 PERMISSIVE policies |
| Sync Engine | Atomic sync manager + service worker | 3-step deferred synced_at pattern |
| Report Generation | 3 Edge Functions (HTML/PDF) | Deno runtime |
| Notifications | Push (VAPID) + Email (Resend) + In-app | Database triggers → Edge Functions |
| AI | Name extraction via Lovable AI gateway | Gemini 2.5 Flash Lite |

### Third-Party Integrations
- Supabase (DB, Auth, Storage, Edge Functions, Realtime)
- Resend (transactional email)
- Make.com (webhooks for contact/notifications)
- Lovable AI Gateway (name extraction)
- Web Push API (VAPID notifications)

### Database Schema (Key Tables)
- **Parent tables**: `inspections`, `trainings`, `daily_assessments`
- **Child tables**: 6 per inspection, 6 per training, 6 per assessment (~18 child tables)
- **Support tables**: `profiles`, `organizations`, `user_roles`, `audit_logs`, `sync_conflicts`, `push_subscriptions`, `notification_preferences`, `webhook_config`, `report_deleted_items`, `migration_audit`

---

## 2. Failure Mode & Effect Analysis (FMEA)

### CRITICAL — Severity 9-10/10

| ID | Component | Failure Mode | Effect | Severity |
|----|-----------|-------------|--------|----------|
| F1 | **RLS Policies** (SECURITY SCAN FALSE POSITIVE — VERIFIED OK) | Scan flagged all policies as RESTRICTIVE | Verified via `pg_policy`: all are PERMISSIVE. **No action needed.** | ~~10~~ → 0 |
| F2 | **Service Worker `sw-sync.js`** | Uses hardcoded anon key (line 140) for `Authorization: Bearer` | The SW uses the **anon key** as the bearer token instead of the user's JWT. PostgREST with RLS will reject writes or allow unauthenticated-level access. This means SW background sync may silently fail on any table with user-scoped RLS. | **10** |
| F3 | **`profiles_public`** | No RLS policies detected | User PII (names, avatar URLs) potentially exposed to anonymous users. | **8** |
| F4 | **Transaction Manager Rollback** | Client-side rollback is best-effort, not atomic | If step 3/5 fails and rollback of step 2 also fails (network drop), data is left in inconsistent state. No server-side transaction wrapping. | **7** |

### HIGH — Severity 6-8/10

| ID | Component | Failure Mode | Effect | Severity |
|----|-----------|-------------|--------|----------|
| F5 | **IndexedDB Circuit Breaker** | 1-minute cooldown silently drops writes | User sees "saving" but data is not persisted locally. Toast notification exists but is session-gated (shown once). | **7** |
| F6 | **QueryClient singleton outside component tree** (App.tsx line 40) | `new QueryClient()` at module scope | If module re-evaluates (HMR, dynamic import edge cases), cache is lost. Minor in production but can cause stale data. | **4** |
| F7 | **Conflict Resolution** | Last-write-wins with 5s tolerance | Two users editing same report within 5s window → silent data loss for one user. No merge strategy. | **7** |
| F8 | **`super_admin` cached in localStorage** | `cached-super-admin-status` in localStorage | Attacker can set `localStorage.setItem('cached-super-admin-status', 'true')` to see admin UI. **However**, all admin operations use server-side `is_super_admin()` RPC — so this is UI-only exposure, not privilege escalation. | **3** |

### MEDIUM — Severity 3-5/10

| ID | Component | Failure Mode | Effect | Severity |
|----|-----------|-------------|--------|----------|
| F9 | **Edge Function rate limiter** | In-memory Map resets on cold start | Rate limiting is ineffective under high concurrency (each isolate gets fresh state). | **5** |
| F10 | **Photo sync batch size (10)** | Large photo backlogs block report sync | 10 photos × upload time can consume entire sync window. Reports wait. | **4** |
| F11 | **`withTimeout` fallback resolves (not rejects)** | Callers can't distinguish timeout from success returning fallback value | Already mitigated with TIMEOUT_SENTINEL pattern in `withIndexedDBErrorBoundary`. | **2** |

---

## 3. Edge Case Stress-Test Scenarios

### High Concurrency
- **Scenario**: 50 users complete inspections simultaneously → 50 database triggers fire `send-push-notification` and `send-notification-email` concurrently.
- **Risk**: Edge function cold starts + in-memory rate limiter reset = all 100 requests hit Resend API simultaneously. Resend rate limit (100/s free tier) could throttle.
- **Mitigation**: Already partially addressed by webhook-based architecture. Consider database-level queuing.

### Data Corruption
- **Scenario**: IndexedDB write succeeds for parent but times out for children → circuit breaker trips → subsequent saves silently dropped.
- **Risk**: Parent record exists in IDB without children. Next sync sends empty children → blocked by `empty_local_guard` (already mitigated).
- **Remaining risk**: If circuit breaker trips during a manual save, user loses that save. Toast notification exists but may be missed.

### Network Latency
- **Scenario**: 3G connection during sync → step 2/5 of atomic sync times out at 15s → rollback attempted on slow connection → rollback also times out.
- **Risk**: Partial server state (parent updated, some children upserted, others not). Next sync cycle will retry and `merge-duplicates` will converge.
- **Assessment**: Self-healing on retry. Acceptable.

### SW Auth Expiry
- **Scenario**: Service worker fires background sync 6 hours after last user interaction → JWT expired → SW uses anon key → all writes rejected by RLS.
- **Risk**: SW sync silently fails. Data remains in IndexedDB. Main thread sync picks it up on next app open.
- **Assessment**: **F2** is the root cause. SW cannot authenticate as the user.

---

## 4. Production Readiness Assessment

### Security ✅ (with caveats)
- **No secrets in frontend code** — all sensitive keys are in edge function environment variables.
- **Exception**: `sw-sync.js` line 140 contains the **anon key** hardcoded. This is the publishable key (not service role), so it's acceptable per Supabase guidelines — BUT it's used as `Authorization: Bearer` which means the SW operates as anonymous, not as the authenticated user. This is the root of **F2**.
- **RLS**: 192 policies, all PERMISSIVE, properly enforced. `is_super_admin()` SECURITY DEFINER function prevents recursive RLS.
- **`profiles_public`**: Needs RLS or verification that it's a security-barrier view.

### Scalability ⚠️
- **IndexedDB**: Single-database, 24 stores. No sharding. Works for current scale (~hundreds of records per user).
- **Supabase**: Default 1000-row query limit noted in codebase. Dashboard uses 10,000-row limit for orphan cleanup.
- **Edge Functions**: Stateless, auto-scaling. Rate limiter is per-isolate (ineffective at scale).
- **Sync batching**: MAX_BATCH_SIZE=5 with accelerated re-sync. Handles 22-item queues in ~25s.

### Maintainability ⚠️
- **Codebase size**: ~2000-line files (offline-storage.ts, atomic-sync-manager.ts). High complexity.
- **Deprecated code**: `sync-manager.ts` has deprecated functions that throw — good guardrails.
- **Test coverage**: Unit tests exist for critical paths (local-data-guards, sw-sync-validators, version-calculator). No integration tests for sync pipeline.
- **27 database triggers**: Monitored by `check_trigger_health()` — good practice.

---

## 5. Risk Mitigation — Prioritized Remediation Plan

### Phase 1: Immediate/Critical

| Risk | Severity | Remediation | Effort |
|------|----------|-------------|--------|
| **F2: SW uses anon key as Bearer** | 10 | The SW should retrieve the user's access token from the Supabase auth storage in localStorage (`sb-*-auth-token`) and use it as the Bearer token. Fall back to skipping sync if no valid token exists. | Medium |
| **F3: `profiles_public` missing RLS** | 8 | Verify if it's a view with SECURITY_BARRIER. If it's a table, enable RLS and add a policy restricting SELECT to authenticated users. | Low |

### Phase 2: Performance/Scalability

| Risk | Severity | Remediation | Effort |
|------|----------|-------------|--------|
| **F7: Last-write-wins conflict resolution** | 7 | For current user base, acceptable. Long-term: implement field-level merge or operational transforms. | High |
| **F9: Per-isolate rate limiter** | 5 | Move rate limiting to a database counter table or use Supabase's built-in rate limiting. | Medium |
| **F10: Photo sync blocking report sync** | 4 | Already separated (photos sync after reports in sequence). Consider priority queue where reports always sync first. | Low |

### Phase 3: Technical Debt/Refactoring

| Risk | Severity | Remediation | Effort |
|------|----------|-------------|--------|
| **F4: Client-side rollback** | 7 | Wrap multi-step writes in a Postgres function (single RPC call) for true atomicity. | High |
| **F5: Circuit breaker UX** | 7 | Add persistent banner (not just toast) when circuit breaker is open. Auto-retry with exponential backoff instead of fixed 60s. | Low |
| **Large file complexity** | — | Split `offline-storage.ts` (2000 lines) and `atomic-sync-manager.ts` (2100 lines) into domain-specific modules. | Medium |
| **Missing integration tests** | — | Add end-to-end sync pipeline tests: local save → IndexedDB → atomic sync → server verification → timestamp alignment. | Medium |
| **F8: localStorage admin cache** | 3 | Acceptable as-is since all admin operations validate server-side. Optionally move to sessionStorage to limit persistence. | Low |

---

### Summary

The system is **well-hardened for its domain** — the multi-layered data integrity architecture (circuit breaker, field-count regression guard, partial-read detection, pre-sync versioning, reconciliation audit log) is sophisticated and production-tested.

**The single most critical finding is F2**: the service worker authenticates with the anon key rather than the user's JWT, which means background sync operates without user-level RLS permissions. This should be addressed before any other item.

