/**
 * Active-Edit Guard — narrow, form-local utility.
 *
 * Centralises the question "is the user currently editing this form?" so
 * loaders, refetch handlers, and realtime payload handlers can decide to
 * MERGE or SKIP an incoming snapshot instead of wholesale-replacing local
 * state. This intentionally does NOT own form state, debounce timers, or
 * any sync state; callers pass in the refs they already maintain.
 *
 * Design constraints (per implementation plan):
 *   - No competing sync architecture; just a decision helper + tiny ring
 *     buffer for diagnostics.
 *   - No persistence: ring buffer is in-memory only.
 *   - Metadata only: never accept or log report field VALUES, only field
 *     names, row ids, reasons, and timestamps.
 *
 * Used by:
 *   - TrainingForm reconcile branch
 *   - InspectionForm reconcile branch
 *   - DailyAssessmentForm reconcile branch
 *   - SyncDiagnosticsSheet (read-only viewer)
 */

import type { MutableRefObject } from 'react';

export type ActiveEditReason =
  | 'dirty'
  | 'debounce'
  | 'in-flight'
  | 'recent-write'
  | 'focused';

export interface ActiveEditGuardInput {
  /** True when the form has unsaved local edits. */
  hasUnsavedRef: MutableRefObject<boolean>;
  /** Pending auto-save debounce timer (null if no save is queued). */
  debounceTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  /** Optional: true while a save round-trip is in flight. */
  isSavingRef?: MutableRefObject<boolean>;
  /** Optional: epoch ms of the last local write that landed. */
  lastWriteAtRef?: MutableRefObject<number>;
  /** Window (ms) after lastWriteAt where local still wins. Default 5_000. */
  recentWriteWindowMs?: number;
  /**
   * Optional CSS selector. When provided, returns 'focused' if
   * `document.activeElement` is inside a matching container — used to keep
   * the Training Summary card's rich-text editor immune to refetches while
   * the cursor is inside it.
   */
  focusContainerSelector?: string;
}

export interface ActiveEditDecision {
  active: boolean;
  reason: ActiveEditReason | null;
}

export function isFieldActivelyEdited(input: ActiveEditGuardInput): ActiveEditDecision {
  if (input.hasUnsavedRef.current) return { active: true, reason: 'dirty' };
  if (input.debounceTimerRef.current) return { active: true, reason: 'debounce' };
  if (input.isSavingRef?.current) return { active: true, reason: 'in-flight' };
  if (input.lastWriteAtRef && input.lastWriteAtRef.current > 0) {
    const window = input.recentWriteWindowMs ?? 5_000;
    if (Date.now() - input.lastWriteAtRef.current < window) {
      return { active: true, reason: 'recent-write' };
    }
  }
  if (input.focusContainerSelector && typeof document !== 'undefined') {
    const el = document.activeElement;
    if (el && el.closest && el.closest(input.focusContainerSelector)) {
      return { active: true, reason: 'focused' };
    }
  }
  return { active: false, reason: null };
}

// ──────────────────────────────────────────────────────────────────────────
// Diagnostics ring buffer (in-memory, metadata-only, never persisted)
// ──────────────────────────────────────────────────────────────────────────

export interface ActiveEditSkipEvent {
  at: number;                       // epoch ms
  form: 'training' | 'inspection' | 'daily_assessment';
  table: string;                    // e.g. 'summary', 'delivery_approaches'
  rowId?: string | null;            // optional row id (NEVER content)
  field?: string | null;            // optional field NAME (NEVER value)
  reason: ActiveEditReason;
  source: 'load' | 'realtime' | 'visibility' | 'background-sync' | 'refetch';
}

const MAX_EVENTS = 50;
const ring: ActiveEditSkipEvent[] = [];
const listeners = new Set<() => void>();

export function recordActiveEditSkip(ev: Omit<ActiveEditSkipEvent, 'at'>): void {
  ring.push({ ...ev, at: Date.now() });
  if (ring.length > MAX_EVENTS) ring.splice(0, ring.length - MAX_EVENTS);
  for (const fn of listeners) {
    try { fn(); } catch { /* listener must not break the guard */ }
  }
  if (typeof console !== 'undefined') {
    // Metadata-only structured log.
    // eslint-disable-next-line no-console
    console.info('[ActiveEditGuard] skipped', {
      form: ev.form,
      table: ev.table,
      rowId: ev.rowId ?? null,
      field: ev.field ?? null,
      reason: ev.reason,
      source: ev.source,
    });
  }
}

export function getActiveEditSkipEvents(): readonly ActiveEditSkipEvent[] {
  return ring.slice();
}

export function subscribeActiveEditSkips(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function clearActiveEditSkipEvents(): void {
  ring.length = 0;
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}
