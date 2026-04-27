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

export interface LogContext {
  scope?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

export function logError(err: unknown, ctx: LogContext = {}): void {
  const payload = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    scope: ctx.scope,
    userId: ctx.userId,
    extra: ctx.extra,
    ts: new Date().toISOString(),
    appVersion: (import.meta as any).env?.APP_VERSION,
  };

  // Always log locally first
  console.error("[logError]", payload);

  // Forward to Sentry (best-effort; production-only inside the helper).
  // Both `.then` and `.catch` swallow so a synchronous throw inside
  // `captureException` (or a rejected import) cannot surface as an
  // unhandled rejection. Logging must NEVER mask the original error.
  try {
    void import("@/lib/sentry")
      .then(({ captureException }) => {
        try {
          captureException(err, {
            scope: ctx.scope,
            userId: ctx.userId,
            ...(ctx.extra ?? {}),
          });
        } catch {
          /* swallow */
        }
      })
      .catch(() => { /* swallow */ });
  } catch {
    /* swallow — logging must never throw */
  }

  // Forward to backend audit_logs (best-effort; never block caller)
  try {
    void import("@/integrations/supabase/client").then(({ supabase }) => {
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
    });
  } catch {
    /* ignore */
  }
}
