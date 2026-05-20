# Enable photo-trace in preview/prod builds via URL flag

## Root cause of empty `window.__photoTrace`

Lovable preview (`id-preview--…lovable.app`) is served as a **production Vite build**, so `import.meta.env.DEV === false`. Every `if (import.meta.env.DEV) photoTrace(...)` block is dead-code-eliminated, so the ring buffer never gets populated and `window.__photoTrace` is `undefined`.

## Fix (narrow, temporary, diagnostic-only)

Add a second activation path: URL flag with sticky `localStorage`. No behavior changes; zero production noise unless explicitly opted in.

### 1. `src/lib/photo-trace.ts` — runtime enable with on/off switch

```ts
const LS_KEY = 'photo_trace';
let _enabled: boolean | null = null;

export function isPhotoTraceEnabled(): boolean {
  if (_enabled !== null) return _enabled;
  try {
    const qs = new URLSearchParams(window.location.search);
    const flag = qs.get('photoTrace');
    if (flag === '0' || flag === 'off') {
      try { localStorage.removeItem(LS_KEY); } catch {}
      return (_enabled = false);                 // explicit off for this load
    }
    if (flag === '1' || flag === 'on') {
      try { localStorage.setItem(LS_KEY, '1'); } catch {}
      return (_enabled = true);
    }
    if (import.meta.env.DEV) return (_enabled = true);
    if (localStorage.getItem(LS_KEY) === '1') return (_enabled = true);
  } catch {}
  return (_enabled = false);
}
```

- `?photoTrace=1` → enable + persist (sticky across SPA navigation).
- `?photoTrace=0` → remove `localStorage.photo_trace` + disable for that page load.
- DEV builds stay on automatically.
- Cached per page load → zero per-call overhead.

`photoTrace()` and `newPhotoCid()` early-return on `!isPhotoTraceEnabled()` instead of checking `import.meta.env.DEV`. Ring buffer, `window.__photoTrace`, and `[photo-trace …]` console prefix unchanged.

### 2. Remove outer `import.meta.env.DEV` wrappers at call sites

`ItemPhotoUpload.tsx`, `PhotoGallery.tsx`, `EquipmentTable.tsx`, `ZiplinesTable.tsx`, `OperatingSystemsTable.tsx` currently wrap each `photoTrace(...)` in `if (import.meta.env.DEV) { ... }`, defeating the runtime flag. Drop those outer wrappers around `photoTrace(...)` calls only. The new internal check is the single source of truth and is a no-op when disabled. Any non-photoTrace `console.debug` left over stays guarded.

### 3. Boot confirmation log

In `src/main.tsx`:

```ts
import { isPhotoTraceEnabled } from '@/lib/photo-trace';
if (isPhotoTraceEnabled()) {
  console.log('[photo-trace] enabled — window.__photoTrace ring buffer active');
}
```

## Usage instructions (after merge)

Enable for a session:

```
https://id-preview--93f93be1-56ac-449d-97cf-041ac1649624.lovable.app/?photoTrace=1
```

Or against the production domain:

```
https://rwreports.com/?photoTrace=1
```

You should see in the browser DevTools Console immediately on load:

```
[photo-trace] enabled — window.__photoTrace ring buffer active
```

Then navigate to the inspection report and reproduce the bug. After repro:

```js
copy(JSON.stringify(window.__photoTrace, null, 2));
```

To disable: visit `…/?photoTrace=0` once (clears `localStorage.photo_trace` and disables for that load). Subsequent loads without the flag stay disabled.

## Validation

1. Open preview with `?photoTrace=1` → confirm `[photo-trace] enabled …` in Console.
2. Reproduce Harnesses double-upload and Mohawk Walk cases; confirm `window.__photoTrace` populated.
3. Open preview with `?photoTrace=0` → no enabled log, `window.__photoTrace` undefined.
4. Open preview with no flag and no prior localStorage → no enabled log (default off in prod).
5. `bunx vitest run` — no regressions.

## Out of scope / untouched

No DB schema, RLS, service worker, offline queue, UUID/temp-ID, dashboard, sessionStorage, Save Progress, report/PDF, photo-section semantics, 0-byte rejection, retry, or caption-persistence behavior. Pure diagnostic plumbing.

## Files to change

- `src/lib/photo-trace.ts` — runtime enable check with on/off + export.
- `src/main.tsx` — boot confirmation log.
- `src/components/inspection/ItemPhotoUpload.tsx` — drop outer `if (import.meta.env.DEV)` wrappers around `photoTrace(...)`.
- `src/components/PhotoGallery.tsx` — same.
- `src/components/inspection/EquipmentTable.tsx` — same.
- `src/components/inspection/ZiplinesTable.tsx` — same.
- `src/components/inspection/OperatingSystemsTable.tsx` — same.
