# Add Sentry Error Monitoring

Integrate `@sentry/react` for production error tracking using the provided DSN.

## What gets added

**1. Dependency**
- `@sentry/react`

**2. New file: `src/lib/sentry.ts`**
- Exports `initSentry()` that calls `Sentry.init({ ... })` with:
  - DSN: `https://0432eff5c29b88a4c841c4560f7f3072@o4511277693927424.ingest.us.sentry.io/4511277721190400` (publishable, safe to commit)
  - `enabled: import.meta.env.PROD` — skip dev/preview noise
  - `release` set to the auto-generated `APP_VERSION` (already exposed via `vite-auto-version.ts`)
  - `environment` derived from hostname (production vs preview)
  - `sendDefaultPii: true` (matches Sentry's suggested snippet)
  - No tracing, no replay, no logs, no metrics — error monitoring only
- Also exports a small helper `captureException(err, ctx?)` so other modules can report without importing Sentry directly.

**3. Wire into bootstrap: `src/main.tsx`**
- Call `initSentry()` before `createRoot(...).render(<App />)`.

**4. ErrorBoundary: `src/App.tsx`**
- Wrap `<RouterProvider router={router} />` in `<Sentry.ErrorBoundary fallback={...}>` so unhandled render errors are reported and the user sees a graceful message instead of a blank screen.

**5. Hook into existing logger: `src/lib/log-error.ts`**
- After the existing `console.error` + audit-log forwarding, also call `Sentry.captureException(err, { extra: ctx })`.
- This means every existing `logError()` call site (sync manager, sign-out, photo upload, completion lock, attestation, etc.) automatically reports to Sentry — no other files need to change.
- Keep it best-effort (try/catch swallow) so logging never throws.

## What is intentionally NOT included

- Session Replay, Tracing, Logs, Metrics (only Error Monitoring was checked in your screenshot)
- Source-map upload (requires a Sentry auth token + CI step — happy to add later if you want readable stack traces)
- No edge-function changes — Sentry runs client-side only

## Files touched

- `package.json` / `bun.lock` (add `@sentry/react`)
- `src/lib/sentry.ts` (new)
- `src/main.tsx` (call `initSentry`)
- `src/App.tsx` (wrap in `Sentry.ErrorBoundary`)
- `src/lib/log-error.ts` (forward to Sentry)
