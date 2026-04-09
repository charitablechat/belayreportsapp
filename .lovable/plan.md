

# Fix: 2 Remaining "Not Authenticated" Gaps

## Gap 1: `src/components/OrganizationAutocomplete.tsx` (line 49-55)
Uses raw `supabase.auth.getUser()` which makes a network call and fails offline. Replace with `getUserWithCache()` + `getOfflineUserId()` fallback:
```typescript
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";

useEffect(() => {
  const getUser = async () => {
    const user = await getUserWithCache();
    setUserId(user?.id ?? getOfflineUserId());
  };
  getUser();
}, []);
```

## Gap 2: `src/pages/Onboarding.tsx` (line 72-74)
Still throws "Not authenticated" without trying `getOfflineUserId()`. Add the fallback:
```typescript
let user = await getUserWithCache();
if (!user) {
  const { getOfflineUserId } = await import("@/lib/cached-auth");
  const offlineId = getOfflineUserId();
  if (offlineId) user = { id: offlineId } as any;
}
if (!user) throw new Error("Not authenticated");
```

## Files Changed
1. `src/components/OrganizationAutocomplete.tsx` — switch to cached auth with offline fallback
2. `src/pages/Onboarding.tsx` — add `getOfflineUserId()` fallback

These are the last two gaps. After this fix, every client-side auth check in the app will have an offline fallback.

