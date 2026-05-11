## Root cause (confirmed)

The Known Issues and Developer Notes cards are silently failing to save because of a mismatch between the UI gate and the database RLS gate, combined with a missing post-write verification.

1. **UI gate** — `Dashboard.tsx` computes `isSuperAdmin` from the RPC `is_admin_or_above` (returns true for any `admin` or `super_admin`). It then passes `isSuperAdmin={!!isSuperAdmin}` to `KnownIssuesCard` and `DeveloperNotesCard`, so every admin sees the **Edit** button.
2. **DB gate** — RLS on `app_announcements` uses `is_super_admin()`, which requires `user_roles.role = 'super_admin'`. Querying `user_roles`, there are **zero** rows with role `super_admin` — only `admin`. So every UPDATE from the app is filtered to 0 rows by RLS.
3. **No error surfaced** — PostgREST does not return an error when RLS filters out the target row; the `.update().eq('id', …)` call resolves with `error: null` and an empty result. The component then runs the success branch, sets state, and shows "updated successfully". A page refetch pulls the unchanged server row and the edit disappears — exactly the symptom reported.

Same bug pattern lives in both `src/components/dashboard/KnownIssuesCard.tsx` (line 79–94) and `src/components/dashboard/DeveloperNotesCard.tsx` (line 73–88).

## Fix (Known Issues + Developer Notes)

1. **Align the DB policy with the UI**: replace the two `is_super_admin()` policies on `public.app_announcements` with `is_admin_or_above()` so admins (the people who can press Edit) can actually write. Per the project's RBAC memory, this is the canonical check and the "True Super Admin" tier is read-only and invisible — there are no super_admin rows by design.
2. **Verify writes in the components**: change both cards' `update(...)` calls to `update(...).select('id, content, updated_at').single()` and treat "no row returned" as a failure (toast "Save failed — you may not have permission" and roll the editor back). This converts every future silent RLS filter into a visible failure.

## Wider audit — same anti-pattern across the app

The fragile pattern is: **`supabase.from(X).update(…).eq('id', …)` with no `.select()` and no row-count check**. Whenever RLS filters the target row, the call returns `{ error: null, data: null }` and the caller cheerfully reports success. I will sweep the codebase for this pattern and harden the high-impact write paths.

### Audit scope (priority order)

1. **Announcements** (this bug) — already covered above.
2. **Report writes** — `inspection_reports`, `training_reports`, `daily_assessment_reports` updates from form save paths, admin reassignment flows, completion lock toggles, and invoiced-status toggles. These are the highest-stakes writes; a silent failure here = lost field data.
3. **Inspection / training / daily_assessment header & item rows** — same `update().eq('id', …)` shape used in autosave.
4. **Profile + role writes** — `profiles`, `user_roles`, `organization_members` from Admin User Management; `is_super_admin()` policies here are correct (intentional gate), but the UI must still detect "0 rows updated" and tell the operator the action was denied.
5. **Notification preferences, app_announcements, onboarding resources, equipment_type_options, system_type_options, autocomplete tables** — secondary, but same pattern likely present.
6. **Photo metadata updates** (`inspection_photos`, `training_photos` caption / order updates).
7. **Edge function writes** that use the **anon** client on the user's JWT (not service-role). Service-role writes bypass RLS so they aren't at risk for this specific bug, but I'll spot-check that the few user-JWT functions (`admin-manage-user`, `send-report-email` status updates, `generate-inspection-html` HTML cache write, etc.) all handle empty result sets.

### What I will check for each write path

- **RLS vs UI gate match** — does the policy actually permit the user the UI is showing the control to?
- **Result verification** — every important `.update()` / `.upsert()` / `.delete()` either chains `.select()` and asserts a non-empty result, or uses one of the existing safe wrappers (`safe-functions-invoke`, `non-blocking-save`). I'll wrap the survivors.
- **Optimistic local state** — when the server write silently no-ops, the local IDB row and React state must NOT be marked as "synced". I will cross-check against the `local-first-data-integrity-v3` and `sync-deduplication-guard` memories so we don't introduce regressions there.
- **Toasts** — convert "we ran the call without an error" into "we have a confirmed write" before showing success.

### Out of scope

- The actual content of Known Issues / Developer Notes — the user controls that.
- Cost / retention work from the previous turn — already shipped.
- Sync engine internals (offline → online reconcile). Those already have row-count assertions per the existing memories; I'll only touch direct-from-component writes.

## Deliverables

1. One migration switching the two `app_announcements` policies from `is_super_admin()` to `is_admin_or_above()`.
2. Hardened `KnownIssuesCard.tsx` and `DeveloperNotesCard.tsx` with `.select().single()` verification and a real failure toast.
3. An audit report (posted in chat, not a file) listing every `.update()` / `.upsert()` / `.delete()` call in `src/` that lacks row-count verification, grouped by risk tier, with the specific fixes applied for tier-1 and tier-2 paths. Tier-3 paths get a list and a recommendation, applied only if you green-light a second pass.
4. A new memory entry under `mem://security/silent-rls-no-op` codifying the rule: **every user-initiated mutation must verify it affected ≥1 row before reporting success**.

## Technical notes

- The `is_admin_or_above()` SQL function already exists and is the project-blessed RBAC entry point (per `session-and-rbac-resilience-v2`).
- `app_announcements` has only two rows (`known_issues`, `developer_notes`); changing the policy does not change visibility because the SELECT policy is already `authenticated → true`.
- The component edit gate (`isSuperAdmin` prop) stays as-is — it's already correctly wired to `is_admin_or_above` upstream; only the prop name is misleading. I'll rename it to `canEdit` while I'm in there to prevent the next person from re-introducing the mismatch.

Approve and I'll start with the migration + component fixes, then run the audit sweep in the same pass.