## H1 — Stop orphan-cleanup from silently deleting local records past the 500-row display cap

### Finding

`src/pages/Dashboard.tsx` fetches at most 500 rows from the server for each of the three report types (inspections at line 684, trainings at line 864, daily assessments at line 1027). Each of those code paths then derives `serverIds = new Set(networkData.map(...))` and treats *any* local IDB record not in that set as an orphan to delete (gated only by a 60s "recently modified" / 5min "recently created" grace window).

For a super-admin viewing an org with >500 records, the 501st-Nth records always fall off the page. Once they're older than the grace window, every dashboard load that runs orphan cleanup deletes them locally — including any with unsynced edits. Symptom: "my edits from last night are gone" on super-admin / power-user devices.

The 500-cap exists for *render* performance, not for correctness of the orphan reconciliation. Conflating "what we display" with "what exists on the server" is the bug.

### Fix — separate the orphan-id source from the display query

Inside each `runOrphanCleanup` block (inspections / trainings / daily assessments), before computing `serverIds`, run a second lightweight query against the same table that returns **only `id`** (and `inspector_id` for the non-super-admin owner filter) with **no `.limit()`** — Postgres + Supabase will happily return tens of thousands of UUIDs in a single request, and over the wire it's ~40 bytes per row.

Then build `serverIds` from that exhaustive id-set instead of from `networkData`. The 500-row display query stays exactly as-is.

Skeleton (one block per report type):

```ts
// Inside runOrphanCleanup, replace:
//   const serverIds = new Set(networkData.map((i: any) => i.id));
// with:

let exhaustiveServerIds: Set<string> | null = null;
try {
  const idQuery = supabase
    .from('inspections')
    .select('id')
    .is('deleted_at', null);
  // Match the visibility scope of the display query — super-admins see all,
  // others see only their own (mirrors existing display-query filters above).
  if (!isSuperAdmin) idQuery.eq('inspector_id', userId);
  const { data: idRows, error: idErr } = await idQuery;
  if (idErr) throw idErr;
  exhaustiveServerIds = new Set((idRows || []).map(r => r.id));
} catch (e) {
  console.warn('[Dashboard] Orphan id-fetch failed — skipping cleanup this cycle', e);
  return; // Bail out of cleanup; never delete on incomplete server view.
}

// Then use exhaustiveServerIds where networkData-derived serverIds was used.
```

Two additional safety belts (cheap to add at the same time):

1. **Hard guard on empty id-set:** if the id query somehow returns an empty array but `nonTempLocals.length > 0`, skip cleanup. This catches a transient RLS / network glitch that would otherwise nuke every local row.
2. **Sanity guard on huge negative deltas:** keep the existing 50% / >5 rows guard, but apply it against `exhaustiveServerIds.size` instead of `networkData.length`. With the new exhaustive count this guard becomes mostly a no-op for legitimate cases, which is the goal.

### Files changed

- **`src/pages/Dashboard.tsx`** — three near-identical edits, one per report type (`loadInspections`, `loadTrainingReports`, `loadDailyAssessments`). Each replaces the `serverIds = new Set(networkData...)` line with the exhaustive id-fetch above and updates the existing safety guard to use the exhaustive count.

No other files need changes. The display query, the `.limit(500)`, the cooldown, the deletedOrphans recovery log, and the recency grace windows all stay untouched.

### Edge cases

- **Offline / network failure during the id-fetch:** caught by the `try/catch`; we return without deleting. Display data already rendered is unaffected.
- **Filtered views (non-super-admin):** the id query mirrors the same visibility filter the display query uses (`inspector_id = userId`), so a regular user only ever orphan-cleans their own records — same as today.
- **Soft-deleted records:** `.is('deleted_at', null)` matches the display query, so a soft-deleted-on-server record will be absent from `exhaustiveServerIds` and cleanup will treat it as an orphan locally — same behavior as today, and correct (the C9 quarantine path handles the "unsynced edits + remote-delete" case independently in the sync manager, not here).
- **Very large orgs (10k+ records):** `select id` over 10k rows is well under 500 KB. Acceptable.
- **Cooldown:** the existing 1-hour cooldown still applies, so the second query only fires at most once per hour per report type.

### Risk

Low. Adds one read query per report type per cleanup cycle (≤1/hour). The behavior change is "orphan cleanup now sees the truth instead of the first 500 rows" — strictly safer. Worst-case bug (id-fetch fails) is "cleanup skipped this cycle" → no data loss.

### Verification

- DEV scenario A (the bug): seed >500 inspections in the org, log in as super-admin, ensure ~10 of the older local inspections fall off the 500 cap. Open dashboard, wait for cleanup to run. Expect: those local inspections survive (today they're deleted).
- DEV scenario B (legitimate orphan): create a local inspection, hard-delete it on the server via SQL, wait past the 5-min grace window. Open dashboard. Expect: cleanup removes it locally — same as today.
- DEV scenario C (id-fetch failure): simulate a network error on the id query (e.g., temporarily offline mid-load). Expect: log line `Orphan id-fetch failed — skipping cleanup`, no local deletions, display data still renders.
- DEV scenario D (regular user): same as A but as a non-super-admin with a peer's record locally cached. Expect: peer's record is treated as orphan only if it's not in the user's own id-set — i.e., same RLS-respecting behavior as the display query.
- Repeat A across all three report types.
- `npx tsc --noEmit`.
