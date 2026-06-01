/**
 * Behaviour tests for `useSaveRaceGuard` — the shared hook Inspection
 * and Daily Assessment use to bring their live save/refetch race
 * protection up to Training's standard.
 *
 * Verified:
 *   - `beginSave()` monotonically increments the save sequence and
 *     captures a fresh wall-clock.
 *   - `markFieldTyped(...)` stamps the pending-fields map with a
 *     timestamp newer than the most recent `beginSave()`.
 *   - `typedAfter(sinceMs)` reflects pending stamps; ignored when none.
 *   - `shouldKeepDirty(...)` keeps dirty when (a) any pending stamp is
 *     newer than save start, or (b) row updated_at advanced after save.
 *   - `clearPendingField` / `clearAllPending` only remove the targeted
 *     entries.
 *   - The hook NEVER stamps anything by itself — callers control when
 *     `markFieldTyped` fires, so mount/hydration/refetch flows that
 *     don't call it leave the pending map empty.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSaveRaceGuard } from '@/hooks/useSaveRaceGuard';

describe('useSaveRaceGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initialises with seq=0, startedAt=0, empty pending', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    expect(result.current.saveSeqRef.current).toBe(0);
    expect(result.current.saveStartedAtMsRef.current).toBe(0);
    expect(result.current.pendingFieldsRef.current).toEqual({});
  });

  it('beginSave bumps seq monotonically and captures wall-clock', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    let first!: { seq: number; startedAtMs: number };
    act(() => { first = result.current.beginSave(); });
    expect(first.seq).toBe(1);
    expect(result.current.saveSeqRef.current).toBe(1);
    expect(result.current.saveStartedAtMsRef.current).toBe(Date.parse('2026-06-01T12:00:00.000Z'));
    vi.advanceTimersByTime(5_000);
    let second!: { seq: number; startedAtMs: number };
    act(() => { second = result.current.beginSave(); });
    expect(second.seq).toBe(2);
    expect(result.current.saveSeqRef.current).toBe(2);
    expect(result.current.saveStartedAtMsRef.current).toBeGreaterThan(first.startedAtMs);
  });

  it('markFieldTyped stamps pending with the current time by default', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    act(() => result.current.markFieldTyped('critical_actions'));
    const stamp = result.current.pendingFieldsRef.current.critical_actions;
    expect(Date.parse(stamp)).toBe(Date.parse('2026-06-01T12:00:00.000Z'));
  });

  it('markFieldTyped accepts an explicit ISO timestamp', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    const iso = '2026-06-01T12:34:56.000Z';
    act(() => result.current.markFieldTyped('environment_comments', iso));
    expect(result.current.pendingFieldsRef.current.environment_comments).toBe(iso);
  });

  it('typedAfter reflects newer stamps and ignores older ones', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    let start = 0;
    act(() => { start = result.current.beginSave().startedAtMs; });
    // No stamps yet → false.
    expect(result.current.typedAfter(start)).toBe(false);
    // Advance clock; stamp a field → true.
    vi.advanceTimersByTime(1_000);
    act(() => result.current.markFieldTyped('repairs_performed'));
    expect(result.current.typedAfter(start)).toBe(true);
    // Reference moment in the future → no stamp is newer → false.
    expect(result.current.typedAfter(start + 60_000)).toBe(false);
  });

  it('shouldKeepDirty respects both pending stamps and row updated_at', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    let startedAtMs = 0;
    act(() => { startedAtMs = result.current.beginSave().startedAtMs; });
    // Nothing pending, no advance → false.
    expect(result.current.shouldKeepDirty(null)).toBe(false);
    // Pending stamped AFTER save start → true.
    vi.advanceTimersByTime(2_000);
    act(() => result.current.markFieldTyped('systems_comments'));
    expect(result.current.shouldKeepDirty(null)).toBe(true);
    // Clear pending; pass a row updated_at after save start → still true.
    act(() => result.current.clearAllPending());
    const after = new Date(startedAtMs + 5_000).toISOString();
    expect(result.current.shouldKeepDirty(after)).toBe(true);
    // Older row updated_at → false.
    const before = new Date(startedAtMs - 5_000).toISOString();
    expect(result.current.shouldKeepDirty(before)).toBe(false);
  });

  it('clearPendingField removes only the targeted entry', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    act(() => {
      result.current.markFieldTyped('critical_actions');
      result.current.markFieldTyped('environment_comments');
    });
    act(() => result.current.clearPendingField('critical_actions'));
    expect('critical_actions' in result.current.pendingFieldsRef.current).toBe(false);
    expect('environment_comments' in result.current.pendingFieldsRef.current).toBe(true);
  });

  it('shouldKeepDirty accepts an explicit saveStartedAtMs override', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    // No beginSave yet — explicit override should still work.
    const past = Date.parse('2026-06-01T11:59:55.000Z');
    act(() => result.current.markFieldTyped('repairs_performed'));
    expect(result.current.shouldKeepDirty(null, past)).toBe(true);
    // Override in the future → no stamp newer → false.
    expect(result.current.shouldKeepDirty(null, Date.now() + 60_000)).toBe(false);
  });

  it('does not stamp anything when the form merely mounts (no markFieldTyped call)', () => {
    const { result } = renderHook(() => useSaveRaceGuard());
    // Simulate hydration / controlled-prop reset: NO markFieldTyped calls.
    expect(result.current.pendingFieldsRef.current).toEqual({});
    expect(result.current.typedAfter(Date.now() - 1000)).toBe(false);
  });
});
