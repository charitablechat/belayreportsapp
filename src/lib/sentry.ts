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
    Sentry.init({
      dsn: DSN,
      release: (import.meta as any).env?.APP_VERSION,
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

/** Best-effort capture; never throws. No-op until initSentry() resolves. */
export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  if (!sentryModule) return;
  try {
    sentryModule.captureException(err, ctx ? { extra: ctx } : undefined);
  } catch {
    /* ignore */
  }
}
