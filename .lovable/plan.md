

## Fix Back Navigation to Go Back One Step

**Problem**: The `goBack()` function in `src/lib/navigation.ts` always navigates to `/dashboard` regardless of history. Users expect the back button (device or in-app) to go back one page.

**Solution**: Update `goBack()` to use `navigate(-1)` when there's navigation depth, and only fall back to `/dashboard` when there's no history (e.g., user landed directly on a page).

### Changes

**1. `src/lib/navigation.ts`** — Fix `goBack` to use actual browser history:
```typescript
export function goBack(navigate: (to: string | number) => void) {
  if (navigationDepth > 0) {
    navigationDepth--;
    navigate(-1);
  } else {
    navigate("/dashboard");
  }
}
```

This preserves the depth tracker (already incremented on each in-app navigation in `App.tsx`) and only falls back to `/dashboard` when the user has no in-app history (e.g., opened a direct link).

No other files need changes — all 11 files that call `goBack` will automatically get the correct behavior.

