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
    });
    sentryModule = Sentry;
    initialized = true;
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
