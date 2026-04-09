

# Security & Completeness Audit — 3 Real Issues Found

## Overall Status: SYNC ENGINE SOLID — 3 Security Gaps Need Fixing

The sync engine, data protection layers, and IndexedDB logic are all production-ready (as verified in prior audits). However, the security scan surfaced **2 critical** and **1 medium** finding.

---

## Issue 1 — CRITICAL: Anonymous Upload to inspection-reports Bucket

**Problem:** The storage policy "Service role can upload PDFs" applies to the `{public}` role (unauthenticated users) with only `bucket_id = 'inspection-reports'` as a check. Any anonymous HTTP request can upload arbitrary files to this private bucket.

**Risk:** HIGH — An attacker could fill the bucket with junk data or overwrite existing report PDFs.

**Fix:** Drop the existing policy and recreate it scoped to `service_role` only (which is what the name intended). Edge functions that generate PDFs already use the service role key, so no client code changes are needed.

```sql
DROP POLICY "Service role can upload PDFs" ON storage.objects;
CREATE POLICY "Service role can upload PDFs"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'inspection-reports');
```

---

## Issue 2 — CRITICAL (FALSE POSITIVE): `is_super_admin()` checks `role = 'admin'`

**Status: BY DESIGN — No change needed.**

The codebase comments in `cached-auth.ts` (lines 302-310) explain the intentional naming: `is_super_admin()` maps to the `admin` role (the highest tier, held by 1 user), while `is_admin_or_above()` maps to `admin OR super_admin` roles. The naming is legacy but the access control is correct. No users have unauthorized access.

---

## Issue 3 — MEDIUM: Realtime Channel Leakage

**Problem:** The tables `inspections`, `trainings`, and `daily_assessments` are published to Supabase Realtime, but any authenticated user could subscribe to a channel and receive row-change events for other users' records.

**Risk:** MEDIUM — Data leakage of report metadata (not full content, but field names/values in change payloads).

**Fix:** Since the app only uses Realtime for triggering sync refreshes (not for streaming data to clients), the simplest fix is to remove these tables from the Realtime publication entirely. The sync engine uses polling, not Realtime subscriptions.

```sql
ALTER PUBLICATION supabase_realtime DROP TABLE public.inspections;
ALTER PUBLICATION supabase_realtime DROP TABLE public.trainings;
ALTER PUBLICATION supabase_realtime DROP TABLE public.daily_assessments;
```

---

## Issue 4 — LOW: `global_field_history` readable by all users

**Status: BY DESIGN — No change needed.**

This table powers cross-user autocomplete suggestions (organization names, site names). The `USING (true)` policy is intentional so all users benefit from shared field history. No sensitive personal data is stored — only field labels and common values.

---

## Summary

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | Anonymous storage upload | CRITICAL | Fix policy to `service_role` only |
| 2 | `is_super_admin` naming | False positive | No change (by design) |
| 3 | Realtime channel leakage | MEDIUM | Remove tables from publication |
| 4 | `global_field_history` | By design | No change |

### Plan

**Step 1:** Migration to drop and recreate the storage upload policy with correct role scoping.

**Step 2:** Migration to remove the 3 parent tables from the Realtime publication.

**Step 3:** Verify no client code depends on Realtime subscriptions for these tables (the sync engine uses polling).

Two migrations, zero client code changes.

