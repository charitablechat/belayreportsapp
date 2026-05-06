# Sync notification accuracy — close F3 (photo-aware) gaps

The audit identifies three failure surfaces; F1 (refetch race) is already shipped, F2 (IDB-collapse) is **telemetry-pending and explicitly out of scope** until Sentry data arrives. This plan implements the two F3 fixes that are safe to ship now: the 3-state dashboard badge and the photo-aware cycle toast.

## 1. Dashboard badge — 3-state (audit § 4.1)

**File:** `src/components/dashboard/ReportCard.tsx`

Replace the 2-state badge (`synced_at ? Synced : Local`) with a 3-state badge that consults pending photos for this report:

| Local state | Badge |
|---|---|
| `synced_at == null` | "Local" (gray Cloud icon) — unchanged |
| `synced_at && pendingPhotos > 0` | **"Synced — N photo(s) uploading"** (yellow/amber) |
| `synced_at && pendingPhotos === 0` | "Synced" (green check) — unchanged |

Source pending count from existing `useUnsyncedPhotos()` hook → `photosByInspection[report.id] ?? 0`. The hook already preserves last-known counts on IDB read failure (S11), so the yellow state never flickers to green during a transient read error.

Style follows project tokens (no hard-coded colors): use `text-amber-600 border-amber-300` (matches existing amber utility classes already used for sync warnings) — verify exact token by grepping existing amber usage.

## 2. Photo-aware cycle toast (audit § 4.2)

**File:** `src/hooks/useAutoSync.tsx` (~lines 649–674)

`syncPhotos` returns `{ remaining, changed?, error? }` — no `success`/`failed` counts — so photo failures are invisible to the current toast logic. Photos can stall while reports commit cleanly, producing a green "Data synced successfully" toast in the same cycle photos failed.

Change the success branch to inspect the photo result:

```ts
const photoResult = results[3] as { remaining?: number; error?: string } | null;
const photosStillPending = (photoResult?.remaining ?? 0) > 0 || !!photoResult?.error;

// existing branches above unchanged
} else if (cleanSuccess && !photosStillPending) {
  toast.success(`Data synced successfully (${totalSynced} items)${remainingMsg}`);
  addSyncNotification(`Data synced successfully (${totalSynced} items)${remainingMsg}`);
} else if (cleanSuccess && photosStillPending) {
  const tail = photoResult?.remaining
    ? `${photoResult.remaining} photo(s) still uploading`
    : 'photos still uploading';
  const msg = `Reports synced (${totalSynced} items); ${tail}`;
  toast.warning(msg);
  addSyncNotification(msg);
}
```

The `emitSyncComplete()` / ledger-mark block at line 679 still gates on `cleanSuccess` (reports), which is correct — photos retry on the next cycle and don't block report-completion semantics.

## Out of scope (per audit)

- F2 IDB-collapse fix — awaits next `IdbSaveError [timeout]` Sentry extras
- Widening IDB write budget (8s)
- Atomic-sync transaction shape changes
- Sentry alert rule (UI-only configuration, no code)
- Read-boundary telemetry
- New global photo-state context (use existing `useUnsyncedPhotos`)

## Verification

1. Open a report online, capture a photo, force `inspection-photos` storage 5xx via DevTools → save & sync. Reports row stamps `synced_at`; toast reads "Reports synced … photos still uploading"; dashboard card shows amber "Synced — 1 photo uploading".
2. Recover storage, autosync next cycle → toast reads "Data synced successfully …"; card flips to green Synced.
3. Clean cycle (no photos pending) → green toast + green badge unchanged from today.
4. IDB read failure during photo count → badge stays on last-known amber count instead of flipping to green (S11 preservation).
