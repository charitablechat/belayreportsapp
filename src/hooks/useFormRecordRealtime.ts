import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isIOS } from '@/lib/mobile-detection';
import { syncLog } from '@/lib/sync-logger';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { DbRow } from '@/lib/offline-storage';

/**
 * Audit H2: form-scoped Realtime recovery.
 *
 * Each form (InspectionForm, TrainingForm, DailyAssessmentForm) plus
 * useReportSync subscribes to a per-record postgres_changes channel so a
 * remote edit on another device causes the local view to refresh. The
 * pre-fix code attached `.subscribe()` with no status callback and no
 * recovery on app-resume — so on iOS Safari, when the websocket dies during
 * tab suspension / bfcache / Wi-Fi↔cellular handoff, the form is silently
 * disconnected for the entire editing session and the user misses
 * cross-device updates until they navigate away and back.
 *
 * This helper attaches:
 *   1. A status callback that schedules a debounced fallback refetch on
 *      `CHANNEL_ERROR | TIMED_OUT | CLOSED` — same pattern Dashboard's
 *      channel uses.
 *   2. App-resume listeners (`online`, `visibilitychange→visible` for all
 *      platforms; `pageshow` and `focus` for iOS) that tear down + recreate
 *      the channel, throttled to once per 30s. `pageshow` only triggers on
 *      `event.persisted === true` so initial page loads don't pointlessly
 *      tear down the just-created channel.
 *   3. A one-shot `onResumeOrDegraded()` call after each resume/degraded
 *      event so anything we missed during the dead window gets pulled in.
 *
 * Callbacks are held via refs so callers don't have to wrap them in
 * `useCallback` to avoid re-subscribing on every render.
 */

const REALTIME_RESUBSCRIBE_THROTTLE_MS = 30_000;
const FALLBACK_REFETCH_DEBOUNCE_MS = 1500;

export interface UseFormRecordRealtimeOptions {
  /** Skip subscription entirely (e.g. before id is loaded or for `temp-` ids). */
  enabled: boolean;
  /** Channel name; should be unique per record (e.g. `inspection-form-${id}`). */
  channelName: string;
  /** Postgres table to filter on. */
  table: 'inspections' | 'trainings' | 'daily_assessments';
  /** Record id to filter on (`id=eq.${recordId}`). */
  recordId: string;
  /** Called for every `UPDATE` event from the channel. */
  onUpdate: (payload: RealtimePostgresChangesPayload<DbRow>) => void;
  /**
   * Called once after a degraded-status event (CHANNEL_ERROR/TIMED_OUT/
   * CLOSED) and once after every successful resume-triggered resubscribe.
   * Use this to fetch the record fresh — it covers the gap where the
   * websocket was dead and we missed `UPDATE` events.
   */
  onResumeOrDegraded: () => void;
  /** Log tag, e.g. `'InspectionForm'`. */
  logTag: string;
}

export function useFormRecordRealtime(opts: UseFormRecordRealtimeOptions): void {
  const { enabled, channelName, table, recordId, logTag } = opts;

  const onUpdateRef = useRef(opts.onUpdate);
  const onResumeOrDegradedRef = useRef(opts.onResumeOrDegraded);
  // Refresh callback refs every render so the channel callback always
  // sees the latest closure without re-subscribing on every render.
  useEffect(() => {
    onUpdateRef.current = opts.onUpdate;
    onResumeOrDegradedRef.current = opts.onResumeOrDegraded;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const channelHolder: { current: ReturnType<typeof supabase.channel> | null } = { current: null };
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let lastResubscribeAt = 0;

    const scheduleFallbackRefetch = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        if (cancelled) return;
        onResumeOrDegradedRef.current();
      }, FALLBACK_REFETCH_DEBOUNCE_MS);
    };

    const setupChannel = () => {
      if (channelHolder.current) {
        supabase.removeChannel(channelHolder.current);
        channelHolder.current = null;
      }
      channelHolder.current = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${recordId}` },
          (payload) => onUpdateRef.current(payload as RealtimePostgresChangesPayload<DbRow>),
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // CLOSED also fires during our own teardown via removeChannel(),
            // but in the worst case that just costs us one extra debounced
            // refetch — far cheaper than missing updates.
            console.warn(`[${logTag}] realtime status degraded: ${status} — scheduling fallback refetch`);
            scheduleFallbackRefetch();
          }
        });
    };

    setupChannel();

    const resubscribeIfStale = (reason: string) => {
      const now = Date.now();
      if (now - lastResubscribeAt < REALTIME_RESUBSCRIBE_THROTTLE_MS) {
        syncLog.log(`[${logTag}] realtime resubscribe throttled (${reason})`);
        return;
      }
      lastResubscribeAt = now;
      syncLog.log(`[${logTag}] resubscribing realtime channel — ${reason}`);
      setupChannel();
      // Pull anything we missed while the channel was dead.
      onResumeOrDegradedRef.current();
    };

    const handleOnline = () => resubscribeIfStale('online');
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resubscribeIfStale('visibilitychange');
    };
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resubscribeIfStale('pageshow');
    };
    const handleFocus = () => resubscribeIfStale('focus');

    const isIOSDevice = isIOS();
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (isIOSDevice) {
      window.addEventListener('pageshow', handlePageShow);
      window.addEventListener('focus', handleFocus);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (isIOSDevice) {
        window.removeEventListener('pageshow', handlePageShow);
        window.removeEventListener('focus', handleFocus);
      }
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (channelHolder.current) {
        supabase.removeChannel(channelHolder.current);
        channelHolder.current = null;
      }
    };
  }, [enabled, channelName, table, recordId, logTag]);
}
