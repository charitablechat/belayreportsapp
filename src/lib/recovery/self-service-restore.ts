/**
 * Self-Service Restore — client wrapper for the atomic database function
 * `public.self_service_fill_missing_training_field`.
 *
 * This module is intentionally thin: all authorization, blank-only enforcement,
 * snapshot, and write happen inside the SECURITY DEFINER function in one
 * transaction. The wrapper just translates the typed JSON result into a
 * TypeScript discriminated union and runs the convenience pre-flight that
 * powers showing the "Fill Missing Text" button.
 *
 * Writes performed here: exactly one — the RPC call.
 */

import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache } from '@/lib/cached-auth';
import type { RecoverableField } from '@/lib/recovery/training-recovery-scan';

export type RestoreReason =
  | 'not_signed_in'
  | 'not_owner'
  | 'invalid_field'
  | 'empty_recovered_text'
  | 'field_populated'
  | 'needs_rescan'
  | 'training_not_found'
  | 'conflict'
  | 'internal_error'
  | 'offline'
  | 'rpc_failed';

export type RestoreResult =
  | {
      ok: true;
      training_id: string;
      field: RecoverableField;
      summary_id: string;
      snapshot_id: string;
      server_updated_at: string | null;
      restored_length: number;
    }
  | {
      ok: false;
      reason: RestoreReason;
      /**
       * Raw server-side detail. NEVER show this directly to the user — surface
       * a plain-English message instead. Logged for developer troubleshooting.
       */
      detail?: string;
      server_updated_at?: string | null;
    };

export type Eligibility =
  | { eligible: true; ownerId: string; serverUpdatedAt: string | null }
  | {
      eligible: false;
      reason:
        | 'invalid_field'
        | 'offline'
        | 'not_signed_in'
        | 'not_owner'
        | 'training_not_found'
        | 'field_populated'
        | 'empty_recovered_text'
        | 'lookup_failed';
    };

/** HTML→plain text. Empty if no readable text. */
export function recoveredTextToPlain(html: string): string {
  if (typeof window === 'undefined') return (html ?? '').trim();
  const div = document.createElement('div');
  div.innerHTML = html ?? '';
  return (div.textContent || div.innerText || '').trim();
}

/**
 * Read-only pre-flight that decides whether to show the Fill button. Failures
 * here are advisory — the database function re-checks every condition under
 * lock before any write.
 */
export async function checkEligibility(args: {
  trainingId: string;
  field: RecoverableField;
  recoveredText: string;
}): Promise<Eligibility> {
  if (args.field !== 'observations' && args.field !== 'recommendations') {
    return { eligible: false, reason: 'invalid_field' };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { eligible: false, reason: 'offline' };
  }

  if (recoveredTextToPlain(args.recoveredText) === '') {
    return { eligible: false, reason: 'empty_recovered_text' };
  }

  let userId: string | null = null;
  try {
    const u = await getUserWithCache();
    userId = u?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return { eligible: false, reason: 'not_signed_in' };

  try {
    const { data: training, error: tErr } = await supabase
      .from('trainings')
      .select('id, inspector_id, updated_at')
      .eq('id', args.trainingId)
      .maybeSingle();
    if (tErr) return { eligible: false, reason: 'lookup_failed' };
    if (!training) return { eligible: false, reason: 'training_not_found' };
    if (training.inspector_id !== userId) {
      // UI is owner-only by design.
      return { eligible: false, reason: 'not_owner' };
    }

    const { data: summary, error: sErr } = await supabase
      .from('training_summary')
      .select('observations, recommendations')
      .eq('training_id', args.trainingId)
      .maybeSingle();
    if (sErr) return { eligible: false, reason: 'lookup_failed' };

    const current = summary ? (summary as Record<string, unknown>)[args.field] : null;
    if (typeof current === 'string' && current.trim() !== '') {
      return { eligible: false, reason: 'field_populated' };
    }

    return {
      eligible: true,
      ownerId: training.inspector_id,
      serverUpdatedAt: (training.updated_at as string | null) ?? null,
    };
  } catch {
    return { eligible: false, reason: 'lookup_failed' };
  }
}

/**
 * Calls the atomic restore function. Returns the typed result verbatim, with
 * defensive handling for transport / silent-null responses.
 */
export async function performRestore(args: {
  trainingId: string;
  field: RecoverableField;
  recoveredText: string;
  scanSeenUpdatedAt: string | null;
  clientMetadata?: Record<string, unknown>;
}): Promise<RestoreResult> {
  const normalized = recoveredTextToPlain(args.recoveredText);
  if (normalized === '') {
    return { ok: false, reason: 'empty_recovered_text' };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'offline' };
  }

  type RpcArgs = {
    p_training_id: string;
    p_field: string;
    p_recovered_text: string;
    p_scan_seen_updated_at: string | null;
    p_client_metadata: Record<string, unknown>;
  };

  const payload: RpcArgs = {
    p_training_id: args.trainingId,
    p_field: args.field,
    p_recovered_text: normalized,
    p_scan_seen_updated_at: args.scanSeenUpdatedAt,
    p_client_metadata: {
      ...(args.clientMetadata ?? {}),
      user_agent:
        typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    },
  };

  try {
    // Function name may not yet be in the generated supabase types until they
    // regenerate post-migration; cast narrowly here, not project-wide.
    const { data, error } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: RpcArgs,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>
    )('self_service_fill_missing_training_field', payload);

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[self-service-restore] rpc error', error);
      return { ok: false, reason: 'rpc_failed', detail: error.message };
    }
    if (!data || typeof data !== 'object') {
      // Silent-null guard.
      return { ok: false, reason: 'internal_error', detail: 'empty_response' };
    }

    const result = data as Record<string, unknown>;
    if (result.ok === true) {
      return {
        ok: true,
        training_id: String(result.training_id),
        field: result.field as RecoverableField,
        summary_id: String(result.summary_id),
        snapshot_id: String(result.snapshot_id),
        server_updated_at:
          (result.server_updated_at as string | null) ?? null,
        restored_length: Number(result.restored_length) || normalized.length,
      };
    }

    const reason = (result.reason as RestoreReason) ?? 'internal_error';
    return {
      ok: false,
      reason,
      detail:
        typeof result.detail === 'string' ? (result.detail as string) : undefined,
      server_updated_at:
        (result.server_updated_at as string | null | undefined) ?? null,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[self-service-restore] rpc threw', e);
    return {
      ok: false,
      reason: 'rpc_failed',
      detail: e instanceof Error ? e.message : 'unknown',
    };
  }
}

/**
 * Maps any non-OK restore reason to a plain-English message. NEVER surfaces
 * raw `detail`. Caller still has access to the underlying reason for branching.
 */
export function plainEnglishFailure(reason: RestoreReason): string {
  switch (reason) {
    case 'needs_rescan':
      return 'This report changed since the last check. Please tap Check this report again.';
    case 'field_populated':
      return 'This field already has saved text. Nothing was changed.';
    case 'offline':
      return "You're offline. Reconnect to fill this field. Your recovered text is still here — use Copy or Send to admin.";
    case 'not_signed_in':
      return 'You appear to be signed out. Sign back in and try again.';
    case 'not_owner':
      return 'You can only fill missing text on your own report.';
    case 'invalid_field':
    case 'empty_recovered_text':
    case 'training_not_found':
    case 'conflict':
    case 'internal_error':
    case 'rpc_failed':
    default:
      return "Couldn't fill this in. Your recovered text is still here — use Copy or Send to admin.";
  }
}
