## H6: Expand version-history retention

**Problem:** `MAX_VERSIONS_PER_REPORT = 5` in `src/lib/report-version-manager.ts` makes the immutable version ring fill in well under a minute given typical auto-save cadence. Any data-loss spanning more than ~5 saves is unrecoverable. The docstring even claims "last 10 per report" — code and docs disagree.

## Fix

Switch from a fixed-count ring to a **hybrid time-windowed + count-capped** retention policy that keeps recovery useful across a real working day while still bounding storage growth (snapshots already strip `latest_report_html`, so each entry is small).

**Policy:**
- Keep **all versions from the last 24 hours**, regardless of count.
- Beyond 24h, keep **one keyframe per day for the last 30 days** (the newest version of each day).
- Hard ceiling of **100 versions per report** as a safety cap (in case a runaway loop creates thousands in a day).

**Storage impact:** A heavy day of editing might leave ~50–80 versions; older days collapse to 1/day. Worst case ~100 small JSON snapshots per report — well within IDB budget given the existing `pruneAllVersionsToMax` pressure-relief path.

## Changes

### `src/lib/report-version-manager.ts`
1. Replace `MAX_VERSIONS_PER_REPORT = 5` with three constants:
   - `RECENT_WINDOW_MS = 24 * 60 * 60 * 1000`
   - `KEYFRAME_RETENTION_DAYS = 30`
   - `MAX_VERSIONS_PER_REPORT = 100` (hard ceiling)
2. Rewrite `pruneVersions(reportId)` to apply the hybrid policy:
   - Partition versions by `timestamp` into `recent` (within 24h) and `older`.
   - Group `older` by local-date (`YYYY-MM-DD`); keep only the highest-versionNumber entry per day.
   - Drop any keyframe whose day is older than `KEYFRAME_RETENTION_DAYS`.
   - If the resulting set still exceeds `MAX_VERSIONS_PER_REPORT`, drop oldest keyframes first (recent window is sacrosanct).
3. Update the file's top-of-file docstring to describe the new policy accurately.
4. Leave `pruneAllVersionsToMax(maxVersions)` unchanged — storage-pressure manager continues to force a tighter cap when needed.

### `src/components/admin/VersionHistoryPanel.tsx`
- No functional changes required; the panel already renders whatever versions exist, sorted newest-first. Older entries will naturally appear as one-per-day after pruning.

## Verification
- `npx tsc --noEmit` after edits.
- Manual: open a report, save 6+ times, confirm Version History panel shows all of them (not capped at 5).