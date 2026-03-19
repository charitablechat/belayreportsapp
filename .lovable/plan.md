

## Fix Double-Check Update Bug & Add "Update Now" to Profile Dropdown

### Root Cause
`ManualUpdateButton` has its **own** update-check logic (lines 62-88) with a fixed 2-second `setTimeout`. It never calls the improved `checkForUpdates` from `usePWAUpdate` that waits for the SW state transition. So the first press often misses the update, requiring a second click.

### Plan

**1. `src/components/pwa/ManualUpdateButton.tsx` — Use the hook's `checkForUpdates` instead of duplicated logic**

Replace the manual `registration.update()` + 2s timeout with a call to `usePWA().checkForUpdates()`, which already has the proper SW state-transition listener. After it completes, read `needsUpdate` from the hook to show the correct toast. This eliminates the double-press problem.

Key change in `handleCheckForUpdates`:
```typescript
const handleCheckForUpdates = async () => {
  triggerHaptic('light');
  if (needsUpdate) { /* apply update as before */ return; }
  setChecking(true);
  toast.loading('Checking for updates...', { id: 'update-check' });
  await checkForUpdates();  // from usePWA — waits for SW installed state
  setChecking(false);
  // Toast feedback handled via useEffect watching needsUpdate
};
```

Add a `useEffect` that watches `needsUpdate` transitions (false → true) to show the "Update found!" toast, since the state updates asynchronously.

**2. `src/components/UserProfileDropdown.tsx` — Add "Update Now" menu item**

When `needsUpdate` is true, add a prominent dropdown menu item with a pulsing indicator dot and amber styling that calls `updateAndReload()`. Place it right after the profile item, before other menu items, so it's immediately visible.

```
┌──────────────────────┐
│ 👤 Profile           │
│ 🟠 Update Now        │  ← new, only when needsUpdate === true
│ 📖 Onboarding        │
│ ...                  │
└──────────────────────┘
```

### Files affected

| File | Change |
|------|--------|
| `src/components/pwa/ManualUpdateButton.tsx` | Replace duplicated SW check with `checkForUpdates()` from hook; add `useEffect` for toast on needsUpdate change |
| `src/components/UserProfileDropdown.tsx` | Add conditional "Update Now" menu item with pulse animation when `needsUpdate` is true |

