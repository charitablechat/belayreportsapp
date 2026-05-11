---
name: Silent RLS No-Op Anti-Pattern
description: User-initiated mutations must verify affected row count to detect RLS-filtered silent failures
type: preference
---

PostgREST returns `{ error: null, data: null }` when an `UPDATE`/`DELETE` is filtered by RLS — no error is raised, but zero rows are affected. Callers that only check `error` will falsely report success and the local state will diverge from the database (the symptom: "I edit, see success toast, refresh, change is gone").

**Rule**: Every user-initiated `supabase.from(X).update(...)` and `.delete(...)` from the React app must chain `.select(...)` (or `.select(...).maybeSingle()` for single-row writes) and treat an empty result as a hard failure. Show an actionable error toast — never a success toast.

**How to apply**:

```ts
const { data, error } = await supabase
  .from(table)
  .update(payload)
  .eq('id', id)
  .select('id, ...')
  .maybeSingle();

if (error) throw error;
if (!data) {
  toast.error("Save blocked — you don't have permission, or the row no longer exists.");
  return;
}
```

**Why**: The original symptom that surfaced this rule was Known Issues / Developer Notes silently rejecting all edits because their RLS policy required `is_super_admin()` but the project's RBAC memory dictates that the true super-admin tier is read-only/invisible — no real user matches it. The UI gated the Edit button on `is_admin_or_above`, so admins could open the editor, type, and watch the save vanish.

**Exempt**: sync-engine writes that already verify via a separate read query (see `useReportSync`, the form pages' `updateResult`/`verifyData` patterns) and edge functions running with the service-role key (RLS bypassed).

**Cross-ref**: `mem://security/rbac-three-tier-permissions`, `mem://security/session-and-rbac-resilience-v2`.
