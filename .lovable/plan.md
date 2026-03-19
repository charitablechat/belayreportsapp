

# Comprehensive Architectural Audit Report

## 1. Component Mapping

### Frontend Services
| Component | Purpose | Files |
|-----------|---------|-------|
| PWA Provider | Install, update, network, sync orchestration | `PWAProvider.tsx`, 5+ hooks |
| Offline Storage | IndexedDB v8 with 20+ object stores | `offline-storage.ts` (2012 lines) |
| Atomic Sync Manager | 3-step deferred synced_at pattern | `atomic-sync-manager.ts` (2140 lines) |
| Cached Auth | 3-tier auth (memory → localStorage → network) | `cached-auth.ts` (447 lines) |
| Offline Auth | Trust-then-verify offline sign-in | `offline-auth.ts` |
| Photo Pipeline | Capture, compress, cache, sync across 3 modules | `photo-cache.ts`, `image-compression.ts` |
| Report Version Manager | Field-count regression guard + versioning | `report-version-manager.ts` |

### Database Schema (30+ tables)
- **Core:** inspections, trainings, daily_assessments (parent tables)
- **Child tables:** ~18 child tables (systems, equipment, photos, summaries, etc.)
- **Auth/Admin:** profiles, user_roles, organizations, organization_members, audit_logs
- **Support:** webhook_config, notification_preferences, push_subscriptions, migration_audit

### Edge Functions (27 functions)
- Report generation (PDF/HTML): 6 functions
- Notifications (email/push): 4 functions
- Data operations: export-full-backup, restore-full-backup, admin-manage-user
- Utility: extract-names, convert-heic-photos, initialize-logos, etc.

### Third-Party Integrations
- **Resend** — transactional email
- **Web Push (VAPID)** — push notifications via npm:web-push
- **Make.com** — contact form webhook

---

## 2. Failure Mode & Effect Analysis (FMEA)

### CRITICAL — Severity 10/10

| ID | Risk | Impact | Current Mitigation |
|----|------|--------|--------------------|
| F1 | **`export-full-backup` and `restore-full-backup` have `verify_jwt = false`** | Anyone on the internet can export ALL database data or overwrite the entire database by calling these endpoints. Complete data breach + destruction vector. | `export-full-backup` checks webhook secret OR super admin auth, but `restore-full-backup` also checks auth header — however `verify_jwt=false` means the anon key alone gets past the gateway. The auth check inside the function is the only barrier. |
| F2 | **`migrate-orphaned-photos` has `verify_jwt = false`** | Unauthenticated data mutation endpoint. | None visible. |
| F3 | **Hardcoded Supabase project ID in frontend code** (`sb-ssgzcgvygnsrqalisshx-auth-token` in 3+ files) | Not a secret leak per se (project ID is public), but makes session key construction predictable. Couples code to a specific deployment. | None — this is standard Supabase behavior. |

### HIGH — Severity 7-8/10

| ID | Risk | Impact |
|----|------|--------|
| F4 | **Offline auth password obfuscation is trivially reversible** | XOR with email bytes + base64 is not encryption. Any code with access to localStorage + IndexedDB can recover plaintext passwords. | 
| F5 | **Synthetic offline session uses `access_token: 'offline_placeholder_token'`** | If any code path sends this token to the server, it will fail. More critically, any SW background sync triggered during offline auth could attempt server requests with an invalid token. |
| F6 | **IndexedDB stores use `value: any` typing throughout** | No compile-time safety for the 20+ stores. Schema drift between IndexedDB and Postgres is caught only at runtime sync failures. |
| F7 | **Service Worker (`sw-sync.js`) is a separate, untyped JavaScript file** | Cannot share TypeScript interfaces with the main thread. Sync logic is duplicated between `atomic-sync-manager.ts` and `sw-sync.js`. |

### MEDIUM — Severity 4-6/10

| ID | Risk | Impact |
|----|------|--------|
| F8 | **QueryClient instantiated at module scope** (line 43, App.tsx) | All browser tabs share the same in-memory cache. React Fast Refresh in dev resets it silently. Not a production issue but can cause stale data on multi-tab usage. |
| F9 | **CORS `Access-Control-Allow-Origin: *`** on all edge functions | Permits any domain to call these endpoints. Combined with `verify_jwt=false` on some functions, this widens the attack surface. |
| F10 | **No rate limiting on any edge function** | Notification, email, and backup endpoints can be called at unlimited rate. |

---

## 3. Edge Case Stress-Test Scenarios

| Scenario | Expected Behavior | Risk |
|----------|-------------------|------|
| **22 reports queued offline, user goes online** | Batch processing (5/cycle) with 5s accelerated re-sync handles this. | LOW — already addressed |
| **Two tabs open, both editing same report** | Last-write-wins with no cross-tab lock. Second save silently overwrites first. | MEDIUM — acceptable for single-user app |
| **IndexedDB quota exceeded on mobile Safari** | `checkStorageQuota` + `requestPersistentStorage` exist but unclear if save operations gracefully handle QuotaExceededError. | MEDIUM |
| **User signs in offline, creates 10 reports, real userId differs** | `migrateUserData` updates `inspector_id` across 3 stores. Photos are NOT migrated (missing from migration logic). | HIGH — photo orphaning |
| **Network drops mid-sync (step 2 of 3-step pattern)** | Children are upserted but parent `synced_at` never advanced → record re-syncs next cycle. | LOW — correctly handled |
| **Concurrent SW sync + main-thread sync** | Sync orchestration is documented as single-path via `useAutoSync`, but no distributed lock prevents both running simultaneously. | MEDIUM |

---

## 4. Production Readiness Assessment

### Scalability
- **Query limits:** Dashboard capped at 500 rows; backup export paginates at 1000. Adequate for current scale (~hundreds of reports). Would need cursor-based pagination for 10K+ records.
- **Edge function cold starts:** Standard Deno runtime. No optimization concerns at current volume.
- **IndexedDB:** 20+ object stores × 3 report types. Version 8 schema. Each version bump requires careful migration. No automated migration testing.

### Security Scorecard

| Area | Status | Notes |
|------|--------|-------|
| XSS | ✅ GOOD | DOMPurify used on all `dangerouslySetInnerHTML` |
| Auth | ⚠️ CONCERN | Offline auth stores reversible passwords |
| RLS | ✅ GOOD | Comprehensive policies; SECURITY DEFINER functions for admin bypass |
| Edge Function Auth | 🔴 CRITICAL | 2 data-destructive endpoints lack JWT verification |
| CORS | ⚠️ CONCERN | Wildcard origin on all functions |
| Secrets | ✅ GOOD | No API keys in frontend code; all secrets in edge runtime env |

### Maintainability
- **Code volume:** `offline-storage.ts` (2012 lines), `atomic-sync-manager.ts` (2140 lines) are very large single files.
- **Duplication:** Sync logic exists in both TypeScript (atomic-sync-manager) and vanilla JS (sw-sync.js).
- **Test coverage:** Only 4 test files found (`*.test.ts`). Critical paths (sync, offline auth, migration) lack tests.

---

## 5. Phased Remediation Plan

### Phase 1: Immediate / Critical (do now)

| # | Action | Severity | Effort |
|---|--------|----------|--------|
| 1 | **Set `verify_jwt = true` for `export-full-backup`, `restore-full-backup`, and `migrate-orphaned-photos`** in `config.toml`. The functions already validate auth headers internally, so existing callers will continue to work. This adds gateway-level protection. | 10/10 | 5 min |
| 2 | **Fix offline auth photo migration** — add `photos` store to `migrateUserData()` in `offline-auth.ts`, matching on `inspectionId` ownership. | 8/10 | 30 min |
| 3 | **Add rate limiting to `send-push-notification` and `send-notification-email`** — implement in-memory rate limiter (already have `_shared/rate-limiter.ts`). | 7/10 | 1 hr |

### Phase 2: Performance / Scalability (next sprint)

| # | Action | Severity | Effort |
|---|--------|----------|--------|
| 4 | **Restrict CORS origins** on sensitive edge functions to production domain (`ropeworks.lovable.app`) + preview domain. | 6/10 | 1 hr |
| 5 | **Add QuotaExceededError handling** to all IndexedDB write paths in `offline-storage.ts`. Surface a user-facing warning when storage is near-full. | 5/10 | 2 hr |
| 6 | **Implement cross-tab sync lock** using `navigator.locks` API to prevent concurrent main-thread + SW sync. | 5/10 | 2 hr |

### Phase 3: Technical Debt / Refactoring (backlog)

| # | Action | Severity | Effort |
|---|--------|----------|--------|
| 7 | **Type IndexedDB stores** — replace `value: any` with proper interfaces for all 20+ stores. | 4/10 | 4 hr |
| 8 | **Split large files** — break `offline-storage.ts` and `atomic-sync-manager.ts` into module-per-report-type. | 3/10 | 4 hr |
| 9 | **Add integration tests** for sync pipeline, offline auth flow, and data migration. | 4/10 | 8 hr |
| 10 | **Replace password obfuscation** in offline auth with Web Crypto `AES-GCM` using a device-derived key, or remove password storage entirely and only cache session tokens. | 6/10 | 3 hr |
| 11 | **Unify SW sync logic** — consider generating `sw-sync.js` from TypeScript source or using a shared schema definition. | 3/10 | 8 hr |

