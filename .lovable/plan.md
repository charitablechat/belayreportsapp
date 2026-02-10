

# Final Cleanup: Wrap Remaining Production Console Logs

## Context

All structural fixes (temp-ID guards, orphan cleanup protection, `isInternalUpdateRef` pattern, online guards, `useIOSSync` removal) are verified and stable. The only remaining issue is **7 unguarded `console.log` statements** that leak to production users' browser consoles.

## Changes

### File 1: `src/pages/TrainingForm.tsx`

**Line 323** -- Wrap `localIsNewer` log:
```typescript
if (import.meta.env.DEV) {
  console.log('[TrainingForm] Local data is newer -- preserving local state (parent + child)');
}
```

**Line 447** -- Wrap offline storage completion log:
```typescript
if (import.meta.env.DEV) console.log('[Training Save] Offline storage completed');
```

**Line 901** -- Wrap sync failure log (change to `console.warn` since it indicates a problem):
```typescript
console.warn('[Offline] Failed to sync, queuing operation');
```

### File 2: `src/pages/DailyAssessmentForm.tsx`

**Line 328** -- Wrap `localIsNewer` log:
```typescript
if (import.meta.env.DEV) {
  console.log('[DailyAssessmentForm] Local data is newer -- preserving local state (parent + child)');
}
```

### File 3: `src/pages/Dashboard.tsx`

**Lines 390, 481, 572** -- Wrap all three orphan cleanup logs:
```typescript
if (import.meta.env.DEV) {
  console.log('[Dashboard] Removing orphaned local inspection:', local.id);
}
```
(Same pattern for training and assessment variants.)

## Summary

| File | Lines | Change |
|------|-------|--------|
| TrainingForm.tsx | 323, 447, 901 | Wrap 3 logs with DEV guard |
| DailyAssessmentForm.tsx | 328 | Wrap 1 log with DEV guard |
| Dashboard.tsx | 390, 481, 572 | Wrap 3 logs with DEV guard |

7 total changes across 3 files. No logic changes, only log visibility.
