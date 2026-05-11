# Fix silent save failures + audit data persistence

## Root cause (confirmed)

`app_announcements` (the table behind **Known Issues** and **Developer Notes**) has RLS policies that gate `UPDATE` / `INSERT` on `is_admin_or_above()` — which is correct. But the **client code** in `KnownIssuesCard.tsx` and `DeveloperNotesCard.tsx` fires:

```ts
await supabase.from('app_announcements').update({ content }).eq('announcement_type', 'known_issues')
```

…with **no `.select()` and no row-count check**. When RLS, a stale row, or a missing row causes the update to affect zero rows, PostgREST returns `{ data: null, error: null }`. The component then runs the success branch, shows "Saved", updates local state, and the edit silently vanishes on the next refetch.

This same fragile pattern (`update().eq()` with no verification) is used in many other write paths across the app, so any future RLS drift, ownership mismatch, or soft-delete race will fail silently the same way.

## Plan

### 1. Fix the immediate bug — Known Issues & Developer Notes

In both `src/components/dashboard/KnownIssuesCard.tsx` and `src/components/dashboard/DeveloperNotesCard.tsx`:

- Switch the save mutation to:
  ```ts
  const { data, error } = await supabase
    .from('app_announcements')
    .update({ content, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq('announcement_type', 'known_issues') // or 'developer_notes'
    .select('id, content, updated_at')
    .maybeSingle();
  ```
- Treat `error` OR `!data` as failure → show a real destructive toast ("Save failed — you may not have permission. Your changes have not been saved.") and **do not** clear the dirty/edit state.
- Only on a verified returned row: update local state from `data.content` (server truth), exit edit mode, success toast.
- Add an "unsaved changes" guard so navigating away while dirty prompts the user.
- Ensure the row always exists: add an idempotent upsert seed in the same migration below (one row per `announcement_type`).

### 2. Self-healing migration on `app_announcements`

- Guarantee exactly one row exists for each of `known_issues` and `developer_notes` (insert if missing).
- Add a `UNIQUE` constraint on `announcement_type` so accidental duplicates can't appear.
- Re-confirm RLS is `is_admin_or_above()` for INSERT/UPDATE (already correct per schema), and add an explicit `TO authenticated` on each policy for defense in depth.

### 3. Codebase-wide audit of silent-write patterns

Sweep for `supabase.from(...).update(...)` / `.delete(...)` / `.upsert(...)` calls that **don't** chain `.select()` and don't inspect the result. Prioritized fix list:

| Priority | Area | Why it matters |
|---|---|---|
| P0 | `app_announcements` (this bug) | Reproduced data loss |
| P0 | `inspection_reports`, `training_reports`, `daily_assessment_reports` header writes | Highest stakes — legal/inspection record of truth |
| P0 | Attestation / completion writes (`status`, `attestation_*`, `app_version_at_completion`) | Lock semantics depend on these landing |
| P1 | Inspection items, equipment, standards, summary autosave | WIP loss = inspector rework |
| P1 | Training section/sign-off writes | First-sign-wins integrity |
| P1 | Daily-assessment checklist writes (`*_checks`, `*_of_day`) | Per-row autosave with no verification |
| P1 | Photo metadata updates (caption, display_order, photo_section) | Caption sync memory rule depends on this |
| P2 | `profiles` updates, `notification_preferences`, `user_roles` admin edits | Admin UX bug surface |
| P2 | `equipment_type_options`, `system_type_options`, autocomplete tables | Custom-entry loss |
| P2 | `organizations` upserts / auto-linking | Already memory-tracked |
| P3 | Edge-function service-role writes | Spot-check only — bypass RLS, but verify they read back |

For every P0/P1 hit:
1. Add `.select('id, …key fields')` to the mutation chain.
2. Treat `data == null` (post-RLS filter) as an error, surface a toast, and keep the local dirty state so the user can retry.
3. Where the operation is offline-queued through IndexedDB, also stamp `synced_at` only on confirmed return and leave the local row "dirty" otherwise — preserving the existing `local-first-data-integrity-v3` rule.

### 4. Shared helper to make this hard to get wrong

Add `src/lib/db/verifiedWrite.ts` exporting `verifiedUpdate`, `verifiedInsert`, `verifiedUpsert`, `verifiedDelete`. Each wraps the supabase client call, forces `.select(...)`, throws a typed `SilentWriteError` when zero rows are returned, and logs the table + filter for diagnostics. Migrate the P0/P1 sites to use these helpers; leave others on a follow-up.

### 5. New memory entry

`mem://security/silent-rls-no-op` — every user-initiated mutation MUST verify ≥1 returned row before reporting success; otherwise treat as a permissions/ownership failure.

### 6. Verification

- Manually edit Known Issues and Developer Notes as an admin user → confirm persistence after refetch.
- Force a failing case (e.g. mismatched RLS) in a scratch branch and confirm the destructive toast fires and edit state is retained.
- Run TypeScript build (auto by harness).
- Query `app_announcements` to confirm exactly two rows, one per type, with up-to-date `updated_at`.

## Out of scope (flagged, not changed this pass)

- The previously identified `nightly-retention-cleanup` / backup-pruning work is unaffected by this plan.
- Refactoring offline-sync writers to use `verifiedUpdate` — those already have multi-layer integrity checks; will be a follow-up if the P0/P1 sweep doesn't fully cover them.

## Technical details

- No schema breakage: `app_announcements` gets a UNIQUE constraint + seed rows only.
- No edge-function changes required for the bug fix.
- `verifiedWrite` helpers are additive; existing call sites continue to work until migrated.
- All toast copy stays consistent with the minimal brutalist aesthetic (Georgia serif, no grey backgrounds, destructive variant for failures).
