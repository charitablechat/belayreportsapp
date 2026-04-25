/**
 * Sentry initialization — error monitoring only.
 *
 * - Production-only (skips dev/preview to avoid noise)
 * - DSN is a publishable identifier; safe to commit
 * - Release tag pulled from the auto-generated APP_VERSION
 *   (see vite-auto-version.ts) so issues map cleanly to deploys
 * - No tracing, replay, logs, or metrics
 */
import * as Sentry from "@sentry/react";

const DSN =
  "https://0432eff5c29b88a4c841c4560f7f3072@o4511277693927424.ingest.us.sentry.io/4511277721190400";

let initialized = false;

function deriveEnvironment(): string {
  if (typeof window === "undefined") return "ssr";
  const host = window.location.hostname;
  if (host === "rwreports.com" || host === "www.rwreports.com") return "production";
  if (host.endsWith("lovable.app")) return "preview";
  return "development";
}

export function initSentry(): void {
  if (initialized) return;
  // Only enable in production builds. Dev builds skip entirely.
  if (!import.meta.env.PROD) return;

  try {
    Sentry.init({
      dsn: DSN,
      release: (import.meta as any).env?.APP_VERSION,
      environment: deriveEnvironment(),
      sendDefaultPii: true,
      // Error monitoring only — no tracing/replay.
      tracesSampleRate: 0,
    });
    initialized = true;
  } catch {
    // Sentry must never break the app boot.
  }
}

/** Best-effort capture; never throws. */
export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  try {
    Sentry.captureException(err, ctx ? { extra: ctx } : undefined);
  } catch {
    /* ignore */
  }
}

export { Sentry };
