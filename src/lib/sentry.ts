/**
 * Sentry initialization — error monitoring only.
 *
 * - Production-only (skips dev/preview to avoid noise)
 * - DSN is a publishable identifier; safe to commit
 * - Release tag pulled from the auto-generated APP_VERSION
 *   (see vite-auto-version.ts) so issues map cleanly to deploys
 * - No tracing, replay, logs, or metrics
 *
 * IMPORTANT: Sentry is loaded *dynamically* so the `@sentry/react` package
 * never enters the dev/preview module graph. Statically importing it caused
 * Vite's optimizer to bundle a second React copy, breaking React context
 * (`useContext` returned null inside RouterProvider).
 *
 * `beforeSend` runs `classifyRecoverableSentryEvent` on every event to
 * downgrade well-known recoverable / browser-designed errors (Web Locks
 * tab-coordination handoffs, Safari connection-closing on Supabase Storage
 * uploads, etc.) from `error` to `warning` so they stop generating
 * high-priority email alerts but stay visible in the dashboard for trend
 * review. This complements the call-site classifier in `log-error.ts`,
 * which only sees errors that flow through the `logError()` seam —
 * `beforeSend` catches third-party SDK errors that bypass `logError`.
 */

const DSN =
  "https://0432eff5c29b88a4c841c4560f7f3072@o4511277693927424.ingest.us.sentry.io/4511277721190400";

let initialized = false;
let sentryModule: typeof import("@sentry/react") | null = null;

function deriveEnvironment(): string {
  if (typeof window === "undefined") return "ssr";
  const host = window.location.hostname;
  if (host === "rwreports.com" || host === "www.rwreports.com") return "production";
  if (host.endsWith("lovable.app")) return "preview";
  return "development";
}

/**
 * Result of `classifyRecoverableSentryEvent`. `null` means "don't
 * touch the event"; a non-null result means "downgrade severity and
 * apply this fingerprint for grouping".
 */
export type SentryEventClassification = {
  level: 'warning';
  fingerprint: string[];
} | null;

/**
 * Pure classifier for Sentry's `beforeSend` hook. Returns a downgrade
 * directive when `(name, message)` matches a known recoverable /
 * browser-designed error, otherwise `null`.
 *
 * Adding a new pattern here is the canonical way to silence Sentry
 * email noise for an error class without changing the original
 * throw / catch site — useful when the throw lives in a third-party
 * SDK (Supabase Storage, Supabase Auth's Web Locks coordination,
 * etc.).
 *
 * Caveats:
 * - Match by `name + message` only. Do NOT match on stack frames
 *   (minified in production, fragile across SDK updates).
 * - Use exact-equality (`===`) for the `message` so a future SDK
 *   update that changes the message string surfaces the new wording
 *   as a fresh error instead of being silently swallowed.
 * - Caller wins: `beforeSend` only applies the classification when
 *   the event arrived without an explicit `level` override. (See
 *   `runBeforeSend` below.)
 */
export function classifyRecoverableSentryEvent(
  name: string,
  message: string,
): SentryEventClassification {
  // Web Locks API tab-coordination handoff. Supabase Auth uses
  // `navigator.locks.request(name, { steal: true })` to coordinate
  // which tab leads token refresh; when a new tab opens it steals
  // the lock from the previous leader, whose pending lock-holder
  // promise rejects with this exact `AbortError`. Browser-designed
  // behavior, no recovery action needed — the new tab is now
  // leading and the old tab's auth session is unaffected.
  if (name === 'AbortError' && message === 'Lock was stolen by another request') {
    return {
      level: 'warning',
      fingerprint: ['AbortError', 'lock-stolen', '{{default}}'],
    };
  }

  // Bare `AbortError` (no message, or message === 'AbortError') flowing
  // through `window.onunhandledrejection`. Source is almost always an
  // in-flight `fetch()` cancelled by an `AbortController` (component
  // unmount during navigation, post-online sync teardown, record-status
  // RPC race) — handled by design but the rejection isn't caught
  // explicitly, so Sentry sees it as an unhandled error.
  //
  // Downgrade to `warning` + stable fingerprint so it stops generating
  // high-priority email alerts (this issue currently buries real
  // training-sync failures), but DO NOT drop the event — it stays
  // visible in the dashboard for trend review and the full stack/
  // breadcrumbs survive in case a future real abort lands under this
  // fingerprint. Distinct from the 'Lock was stolen' clause above,
  // which is a specific Supabase Auth pattern.
  if (name === 'AbortError' && (message === '' || message === 'AbortError')) {
    return {
      level: 'warning',
      fingerprint: ['AbortError', 'bare-unhandled-rejection', '{{default}}'],
    };
  }

  // Supabase Storage upload failure surfaced through Safari's
  // notoriously generic 'Load failed' message (Safari maps most
  // network failures — connection-closed, DNS hiccup, brief
  // offline blip — to that same string). Recoverable: PR #151's
  // L5 jittered-backoff stamps `nextRetryAt` on the photo and the
  // next sync cycle retries it automatically.
  if (name === 'StorageUnknownError' && message === 'Load failed') {
    return {
      level: 'warning',
      fingerprint: ['StorageUnknownError', 'load-failed', '{{default}}'],
    };
  }

  // Safari/iOS storage-pressure IDB eviction. WebKit raises this when
  // it evicts the per-origin IndexedDB store under storage pressure or
  // when the user clears site data. Recoverable: `getDB()` retries
  // once internally (re-opens at v0 → DB_VERSION via the existing
  // upgrade path) and the sync layer repopulates from Supabase. See
  // `isIdbDeletedError` + `handleIdbDeletedError` in offline-storage.ts.
  if (
    name === 'UnknownError' &&
    message === 'Database deleted by request of the user'
  ) {
    return {
      level: 'warning',
      fingerprint: ['UnknownError', 'idb-deleted', '{{default}}'],
    };
  }

  return null;
}

/**
 * Apply `classifyRecoverableSentryEvent` to a Sentry event. Exported
 * for unit testing; called from inside the `beforeSend` closure in
 * `initSentry`. Mutates and returns the event so the SDK keeps
 * delivering it (returning `null` would drop it silently, which is
 * NOT what we want — we still want trend visibility in the dashboard,
 * just not an email).
 *
 * Caller-supplied `event.level` (e.g. via `logError`'s call-site
 * classifier in `log-error.ts`) wins: we never override an explicit
 * non-`error` level. The SDK's default for `captureException` is
 * `error`, so 'error' here = 'no caller classification'.
 */
export function runBeforeSend<
  E extends {
    level?: string;
    fingerprint?: string[];
  },
>(event: E, hint?: { originalException?: unknown }): E {
  try {
    if (event.level && event.level !== 'error') return event;
    const ex = hint?.originalException;
    if (!ex || typeof ex !== 'object') return event;
    const e = ex as { name?: unknown; message?: unknown };
    const name = typeof e.name === 'string' ? e.name : '';
    const message = typeof e.message === 'string' ? e.message : '';
    const classification = classifyRecoverableSentryEvent(name, message);
    if (!classification) return event;
    event.level = classification.level;
    event.fingerprint = classification.fingerprint;
  } catch {
    // beforeSend must never break event delivery.
  }
  return event;
}

export async function initSentry(): Promise<void> {
  if (initialized) return;
  if (!import.meta.env.PROD) return;

  try {
    const Sentry = await import("@sentry/react");
    // Lazy import to avoid pulling APP_VERSION_FULL into the static graph
    // before Sentry's chunk loads (this whole module is dynamic-imported).
    const { APP_VERSION_FULL } = await import("./attestation");
    Sentry.init({
      dsn: DSN,
      // PR-C: include build commit so distinct deploys sharing a SemVer
      // (e.g. a Lovable rebuild) produce distinct release groups in Sentry.
      // Audit HIGH-3.
      release: APP_VERSION_FULL,
      environment: deriveEnvironment(),
      sendDefaultPii: true,
      tracesSampleRate: 0,
      beforeSend: (event, hint) => runBeforeSend(event, hint),
    });
    sentryModule = Sentry;
    initialized = true;
    flushPendingSentryUser();
  } catch {
    // Sentry must never break the app boot.
  }
}

/** Sentry severity levels we forward. `error` is the SDK default. */
export type CaptureLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface CaptureOptions {
  /**
   * Severity hint forwarded to `Sentry.captureException`. Defaults to
   * `error`. Use `warning` for handled / recoverable failures (e.g.
   * `Transaction failed after N/M steps. Rollback: successful` — the
   * system already rolled back cleanly and the next periodic sync
   * tick will retry, so the inspector loses nothing) so they don't
   * trigger high-priority alerts in the user's inbox.
   */
  level?: CaptureLevel;
  /**
   * Optional fingerprint for issue grouping. Pass an array of stable
   * tokens (e.g. `['atomic-sync', 'rollback-successful', 'upsert:inspection_ziplines']`)
   * so all step-timeout rollbacks for the same step name collapse into
   * a single Sentry issue you can review weekly, instead of one issue
   * per occurrence. The literal `'{{default}}'` token expands to the
   * SDK's default fingerprint and can be appended to keep
   * stack-trace-based de-duplication alongside the manual grouping.
   */
  fingerprint?: string[];
}

/** Best-effort capture; never throws. No-op until initSentry() resolves. */
export function captureException(
  err: unknown,
  ctx?: Record<string, unknown>,
  options?: CaptureOptions,
): void {
  if (!sentryModule) return;
  try {
    const captureCtx: Record<string, unknown> = {};
    if (ctx && Object.keys(ctx).length > 0) captureCtx.extra = ctx;
    if (options?.level) captureCtx.level = options.level;
    if (options?.fingerprint && options.fingerprint.length > 0) {
      captureCtx.fingerprint = options.fingerprint;
    }
    sentryModule.captureException(
      err,
      Object.keys(captureCtx).length > 0
        ? (captureCtx as Parameters<typeof sentryModule.captureException>[1])
        : undefined,
    );
  } catch {
    /* ignore */
  }
}

/**
 * Attach the authenticated user identity to Sentry so subsequent events
 * include `user.id` / `user.email` instead of only the IP fallback.
 *
 * Safe to call before `initSentry()` resolves — the desired identity is
 * cached and applied as soon as the Sentry module finishes loading.
 *
 * Only forwards safe identifiers (id, email, optional role). Never pass
 * tokens, passwords, refresh tokens, or service-role keys.
 */
export interface SentryUserContext {
  id: string;
  email?: string | null;
  role?: string | null;
}

let pendingUser: SentryUserContext | null | undefined = undefined;

export function setSentryUser(user: SentryUserContext | null): void {
  pendingUser = user;
  if (!sentryModule) return;
  try {
    if (user === null) {
      sentryModule.setUser(null);
      return;
    }
    sentryModule.setUser({
      id: user.id,
      ...(user.email ? { email: user.email } : {}),
      ...(user.role ? { segment: user.role } : {}),
    });
  } catch {
    /* ignore — Sentry must never break the app */
  }
}

/** Exposed for tests; flushes any user set before initSentry resolved. */
export function flushPendingSentryUser(): void {
  if (pendingUser === undefined) return;
  const u = pendingUser;
  pendingUser = undefined;
  setSentryUser(u);
}
