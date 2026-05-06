/**
 * L3: Centralized error-logging seam.
 *
 * Forwards errors to console + (best-effort) the backend `audit_logs` table
 * via the existing `create_audit_log` RPC. Non-blocking — never throws.
 *
 * Adopt at NEW call sites and the highest-signal existing sites
 * (sync manager, sign-out, photo upload, completion lock, attestation).
 * Do not mass-replace existing `console.error` calls.
 */

export type LogLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface LogContext {
  scope?: string;
  userId?: string;
  extra?: Record<string, unknown>;
  /**
   * Mode 13: Severity hint forwarded to Sentry. Defaults to `error`.
   * Use `warning` for handled / recoverable failures so they don't
   * trigger high-priority alerts but stay visible for trend analysis.
   */
  level?: LogLevel;
  /**
   * Mode 13: Optional Sentry fingerprint for issue grouping. See
   * `sentry.ts#CaptureOptions.fingerprint` for usage.
   */
  fingerprint?: string[];
}

/**
 * Auto-classify well-known recoverable errors so callers don't have to
 * remember to set `level: 'warning'` + a stable `fingerprint` at every
 * site. Returns the merged context (caller wins — explicit `level` /
 * `fingerprint` from `ctx` are preserved).
 *
 * `IdbSaveError` is the canonical case: every form save catches it and
 * surfaces a "Save failed — tap to retry" UI, so the user already has
 * a recovery path. Forwarding these to Sentry as `level: 'error'` (the
 * default) generates email-level alerts that say nothing the form's UI
 * doesn't already say. Downgrade to `warning` + group all
 * `(code, operationName)` pairs under one fingerprint so the inbox sees
 * one issue you can review weekly instead of N alerts per occurrence.
 *
 * Mirrors the Mode 13D treatment of recoverable rollbacks in
 * atomic-sync-manager.ts (see PR #131).
 */
function classifyRecoverable(err: unknown, ctx: LogContext): LogContext {
  if (!err || typeof err !== 'object') return ctx;
  const e = err as { name?: unknown; code?: unknown; operationName?: unknown };
  if (e.name !== 'IdbSaveError' || typeof e.code !== 'string') return ctx;
  // Caller wins: never override an explicit level/fingerprint.
  const level: LogLevel = ctx.level ?? 'warning';
  const fingerprint: string[] =
    ctx.fingerprint ??
    [
      'IdbSaveError',
      e.code,
      typeof e.operationName === 'string' ? e.operationName : 'unknown',
      '{{default}}',
    ];
  return { ...ctx, level, fingerprint };
}

export function logError(err: unknown, rawCtx: LogContext = {}): void {
  const ctx = classifyRecoverable(err, rawCtx);
  const payload = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    scope: ctx.scope,
    userId: ctx.userId,
    extra: ctx.extra,
    level: ctx.level,
    ts: new Date().toISOString(),
    appVersion: (import.meta as any).env?.APP_VERSION,
  };

  // Always log locally first. Use console.warn for warnings so the
  // local DevTools view matches the severity we forward to Sentry.
  if (ctx.level === 'warning' || ctx.level === 'info' || ctx.level === 'debug') {
    console.warn("[logError]", payload);
  } else {
    console.error("[logError]", payload);
  }

  // Forward to Sentry (best-effort; production-only inside the helper).
  // Both `.then` and `.catch` swallow so a synchronous throw inside
  // `captureException` (or a rejected import) cannot surface as an
  // unhandled rejection. Logging must NEVER mask the original error.
  try {
    void import("@/lib/sentry")
      .then(({ captureException }) => {
        try {
          captureException(
            err,
            {
              scope: ctx.scope,
              userId: ctx.userId,
              ...(ctx.extra ?? {}),
            },
            {
              level: ctx.level,
              fingerprint: ctx.fingerprint,
            },
          );
        } catch {
          /* swallow */
        }
      })
      .catch(() => { /* swallow */ });
  } catch {
    /* swallow — logging must never throw */
  }

  // Forward to backend audit_logs (best-effort; never block caller).
  // Both `.then` and `.catch` swallow — a rejected import (e.g. supabase
  // chunk fails to load during a deploy rollover) would otherwise surface
  // as an unhandled rejection and, with the new global handler in
  // main.tsx, recurse back into logError indefinitely.
  try {
    void import("@/integrations/supabase/client")
      .then(({ supabase }) => {
        try {
          const p: any = supabase.rpc("create_audit_log", {
            p_user_id: (ctx.userId as any) ?? null,
            p_action_type: "client.error",
            p_table_name: "client",
            p_record_id: null,
            p_old_values: null,
            p_new_values: null,
            p_metadata: payload as any,
          } as any);
          if (p && typeof p.then === "function") {
            p.then(() => {}, () => {});
          }
        } catch {
          /* swallow — logging must never throw */
        }
      })
      .catch(() => { /* swallow */ });
  } catch {
    /* ignore */
  }
}
