

# Fix: Back Button Not Working on Inspection Form

## Root Cause

The `safeGoBack` function in `InspectionForm.tsx` checks `window.history.length > 1` to decide whether to use `navigate(-1)` or fall back to `/dashboard`. However, `window.history.length` counts **all** browser history entries (including cross-origin navigations, iframe loads, and page refreshes), not just React Router entries.

In many real-world scenarios (opening a direct link, preview iframes, PWA launches), `window.history.length` is greater than 1 even though there are no previous React Router pages in the session. This causes `navigate(-1)` to either:
- Navigate to a non-React-Router entry (doing nothing visible), or
- Attempt to leave the app entirely (blocked by the iframe sandbox)

The same utility `goBack` in `src/lib/navigation.ts` has the identical flaw, but InspectionForm doesn't even use it -- it has its own duplicate implementation.

## The Fix

Replace the unreliable `window.history.length` check with a simple session-level navigation tracker that counts actual in-app navigations.

### File 1: `src/lib/navigation.ts`

Add a session navigation depth tracker:

```typescript
let navigationDepth = 0;

export function trackNavigation() {
  navigationDepth++;
}

export function goBack(navigate: (to: string | number) => void) {
  if (navigationDepth > 0) {
    navigationDepth--;
    navigate(-1);
  } else {
    navigate("/dashboard");
  }
}
```

### File 2: `src/App.tsx` (RootLayout)

Track navigations by listening to React Router location changes and incrementing the counter on each push navigation:

```typescript
import { trackNavigation } from "@/lib/navigation";
import { useLocation } from "react-router-dom";

// Inside RootLayout:
const location = useLocation();
const prevLocation = useRef(location.pathname);

useEffect(() => {
  if (location.pathname !== prevLocation.current) {
    trackNavigation();
    prevLocation.current = location.pathname;
  }
}, [location.pathname]);
```

### File 3: `src/pages/InspectionForm.tsx`

Replace the local `safeGoBack` with the shared `goBack` utility:

```typescript
import { goBack } from "@/lib/navigation";

// Remove the local safeGoBack definition and replace usage:
const safeGoBack = useCallback(() => {
  goBack(navigate);
}, [navigate]);
```

## Why This Works

- `navigationDepth` starts at 0 when the app loads
- Each in-app page change increments it
- When back is pressed, if depth > 0, we know there is a real React Router page to go back to
- If depth is 0 (direct link, PWA launch, iframe load), we fall back to `/dashboard`
- The counter is decremented on back navigation to stay accurate

## Files Changed

| File | Change |
|------|--------|
| `src/lib/navigation.ts` | Add navigation depth tracking; update `goBack` to use it |
| `src/App.tsx` | Track route changes in RootLayout to increment depth |
| `src/pages/InspectionForm.tsx` | Use shared `goBack` utility instead of local duplicate |

