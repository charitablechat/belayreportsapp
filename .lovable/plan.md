

## Add a "Preview Snapshot" view before restoring

Right now both the Local and Cloud snapshot panels jump straight from the list to the Restore action — there's no way to see *what's actually inside a snapshot* before overwriting current data with it. Users have to restore blind, hope it's the right one, then verify after the fact. Sometimes it's a stale snapshot and they've just clobbered good data with it.

This adds a **Preview** button next to Restore on every snapshot row (Local + Cloud) that opens a dialog showing the snapshot's contents in a human-readable form, with the Restore action available from inside the preview.

### What the preview shows

A single dialog (`SnapshotPreviewDialog`) that takes a snapshot object and renders:

**Header band** — Report type, organization/facility, saved date + "X minutes ago", device, sync status, total size, snapshot ID (truncated, copyable).

**Summary chips** — quick counts pulled from `snapshot.children`:
- Inspections: systems / equipment / ziplines / standards / photos / summary entries
- Trainings: systems / equipment / operating systems / verifiable items / immediate attention / photos / summary
- Daily assessments: beginning/end of day / environment / equipment / structure / operating systems / photos

**Parent record card** — key fields from `snapshot.parent` rendered as a clean key/value list (organization, location/site, inspection_date / start_date / assessment_date, inspector name, status, completion timestamps, attestation present?, version). Long fields (notes, summary HTML) collapse behind a "Show more" toggle and render as plain text (HTML stripped for safety in preview).

**Child collections** — one collapsible section per non-empty child array:
- Show count badge in section header.
- Inside, a compact table with the most relevant 3–5 columns per type (e.g. equipment: name, type, result, comments) plus a row count footer.
- Photos section: small thumbnail grid using the photo URLs already in the snapshot (lazy-loaded, falls back to a placeholder icon if URL is unreachable).

**Footer actions** — `Close` · `Export JSON` (same as today's Download) · `Restore to Local` (primary, with confirm step that lists what will be overwritten: "This will replace your current draft of [Org] [Date] in local storage. Sync queue is unaffected.").

**Raw JSON drawer** — a "View raw JSON" disclosure at the bottom for power users / debugging, syntax-highlighted in a `<pre>` with copy-to-clipboard. Off by default.

### Wiring

- New file `src/components/admin/SnapshotPreviewDialog.tsx` — single component that accepts `{ open, onOpenChange, snapshotData, onRestore, onExport }`. Snapshot-source-agnostic: works for both Local and Cloud because both already produce the same `{ parent, children }` shape.
- `LocalSnapshotsPanel`: add an `Eye` icon button between Restore and the existing actions on each row (mobile + desktop). Clicking it calls `getReportSnapshot()` (synchronous, already imported) and opens the dialog.
- `CloudSnapshotsPanel`: same `Eye` button. Clicking it calls `fetchCloudSnapshot(s.id)` (async — show a small spinner on the button while loading) then opens the dialog. Cache the fetched snapshot in component state so re-opening the preview for the same row is instant.
- The Restore button inside the dialog routes back through the existing `handleRestore` handlers in each panel — no duplication of restore logic.

### Files to change / add

- **add** `src/components/admin/SnapshotPreviewDialog.tsx` (~250 lines: dialog shell + summary chips + parent card + child sections + photo grid + raw-JSON drawer)
- **edit** `src/components/admin/DataRecoveryTool.tsx`:
  - `LocalSnapshotsPanel` — add Preview button + dialog state, pass through `getReportSnapshot` + existing `handleRestore`/`handleExport`
  - `CloudSnapshotsPanel` — add Preview button + dialog state + per-row loading state, fetch via `fetchCloudSnapshot`, pass through existing `handleRestore`

No DB schema, no edge functions, no new dependencies. Uses existing `Dialog`, `Badge`, `Button`, `Table`, `ScrollArea`, `Collapsible` primitives.

### Risk

- Cloud preview adds one network round-trip per "Preview" click. Mitigated by caching the response in component state for the dialog session, and by showing a spinner so the user knows why the click feels async.
- HTML fields (e.g. summary observations) are rendered as plain text in the preview — no XSS surface even if a snapshot contains hostile content. The "View raw JSON" pane shows escaped JSON, never executed.
- No write paths change. Restore still goes through the existing handlers, so all current safeguards (read-only Lovable preview block, IDB write paths) apply unchanged.

### Verification

1. Open Data Recovery → Local tab → click Preview on any snapshot → dialog shows org, date, parent fields, and a section per non-empty child array with correct row counts.
2. Toggle "View raw JSON" → see the full snapshot, copy works.
3. Click Restore from inside the preview → confirm step appears → confirm → snapshot lands in IndexedDB (same outcome as today's row-level Restore).
4. Open Cloud tab → click Preview → spinner appears, snapshot loads, dialog shows same shape as Local.
5. Close + reopen the same Cloud preview → instant (cached, no network).
6. Preview a snapshot that has photos → thumbnails render in a grid; broken URLs show a placeholder.
7. Search filters still work on both panels; Preview button reachable on filtered rows.
8. On mobile (≤sm viewport) the dialog scrolls cleanly and the action buttons stack at the bottom.

