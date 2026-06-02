/**
 * Slice 5A — Recovery log sanitization helpers.
 *
 * SCOPE LIMIT: This module intentionally contains ONLY log-sanitization
 * helpers used by the four restore handlers in
 * `src/components/admin/DataRecoveryTool.tsx`. It does NOT encode restore
 * policy (no confirmation gate, no stale-snapshot guard, no completion-lock
 * guard, no identity/shape validator, no role/ownership check). Those
 * enforcement helpers belong to Slice 5B/5C and will be added alongside
 * the runtime wiring that actually enforces them — adding policy helpers
 * here without enforcement would create a false sense of safety.
 *
 * Sensitive fields in a recovery snapshot include: organization name,
 * location/site, client info, inspector-entered notes/comments, photo
 * URLs, and arbitrary child-row bodies. None of these are ever read,
 * copied, or returned by the helpers in this file.
 */

/** Shape accepted from caller closures. Intentionally permissive. */
export interface SanitizeRecoveryLogMetadataInput {
  reportType?: string | null;
  reportId?: string | null;
  snapshot?:
    | {
        parent?: Record<string, unknown> | null;
        children?: Record<string, unknown> | null;
      }
    | null;
}

/** Strict whitelist of keys returned. */
export interface SanitizedRecoveryLogMetadata {
  reportType?: string;
  reportId?: string;
  parentId?: string;
  parentUpdatedAt?: string | number | null;
  childCounts?: Record<string, number>;
}

const ALLOWED_REPORT_TYPES = new Set([
  'inspection',
  'training',
  'daily_assessment',
  'daily-assessment',
]);

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickStringOrNumber(value: unknown): string | number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Returns a small, whitelist-only object safe to forward to logs / Sentry.
 *
 * Never reads sensitive fields. Body fields like `organization`,
 * `location`, `site`, `client_name`, `notes`, comment rows, or photo URLs
 * are not included even if present on the input.
 */
export function sanitizeRecoveryLogMetadata(
  input: SanitizeRecoveryLogMetadataInput | null | undefined,
): SanitizedRecoveryLogMetadata {
  const out: SanitizedRecoveryLogMetadata = {};
  if (!input || typeof input !== 'object') return out;

  const rt = pickString(input.reportType);
  if (rt && ALLOWED_REPORT_TYPES.has(rt)) out.reportType = rt;

  const rid = pickString(input.reportId);
  if (rid) out.reportId = rid;

  const parent = input.snapshot?.parent;
  if (parent && typeof parent === 'object') {
    const pid = pickString((parent as Record<string, unknown>).id);
    if (pid) out.parentId = pid;
    const updated = pickStringOrNumber(
      (parent as Record<string, unknown>).updated_at,
    );
    if (updated !== undefined) out.parentUpdatedAt = updated;
  }

  const children = input.snapshot?.children;
  if (children && typeof children === 'object') {
    const counts: Record<string, number> = {};
    for (const [key, val] of Object.entries(children)) {
      if (typeof key !== 'string' || key.length === 0) continue;
      counts[key] = Array.isArray(val) ? val.length : 0;
    }
    if (Object.keys(counts).length > 0) out.childCounts = counts;
  }

  return out;
}

/** Maximum characters retained from an error message. */
const MAX_ERROR_MESSAGE_LEN = 300;

export interface SanitizedRecoveryError {
  name: string;
  message: string;
}

/**
 * Reduce an unknown thrown value to a small `{name, message}` pair safe
 * to forward to logs. Avoids leaking stack traces, nested objects, or
 * payload-like properties (e.g. `cause`, `response`) that may carry
 * report bodies. Always returns a defined object — never throws.
 */
export function sanitizeRecoveryErrorForLog(
  error: unknown,
): SanitizedRecoveryError {
  let name = 'Error';
  let message = 'Unknown error';
  try {
    if (error instanceof Error) {
      if (typeof error.name === 'string' && error.name.length > 0) name = error.name;
      if (typeof error.message === 'string' && error.message.length > 0) message = error.message;
    } else if (typeof error === 'string' && error.length > 0) {
      message = error;
    } else if (error && typeof error === 'object') {
      const maybeName = (error as { name?: unknown }).name;
      const maybeMsg = (error as { message?: unknown }).message;
      if (typeof maybeName === 'string' && maybeName.length > 0) name = maybeName;
      if (typeof maybeMsg === 'string' && maybeMsg.length > 0) message = maybeMsg;
    }
  } catch {
    /* swallow — sanitizer must never throw */
  }
  if (message.length > MAX_ERROR_MESSAGE_LEN) {
    message = message.slice(0, MAX_ERROR_MESSAGE_LEN) + '…';
  }
  return { name, message };
}
