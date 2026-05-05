/**
 * Sprint 1 / C1.1: `saveAndLeave` no longer races against a 5s timeout.
 *
 * The wrapped `performSave` (in InspectionForm / TrainingForm /
 * DailyAssessmentForm) already owns a 30s deadlock-recovery timer. The
 * old inner 5s race in `useUnsavedChanges.saveAndLeave` was shorter than
 * a single Supabase round-trip on flaky cell, and aborted otherwise-
 * successful saves with a misleading "Save timeout" surface.
 *
 * This regression test pins the new contract: a long-running save resolves
 * successfully, even if it takes well over 5 seconds.
 *
 * `useBlocker` requires a data router; we mount the hook inside a
 * `createMemoryRouter` to satisfy that constraint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useUnsavedChanges } from '../useUnsavedChanges';

interface HookOutcome {
  saveAndLeave?: ReturnType<typeof useUnsavedChanges>['saveAndLeave'];
}

function renderUseUnsavedChanges(opts: {
  hasUnsavedChanges: boolean;
  onSaveAndLeave: () => Promise<void>;
}): HookOutcome {
  const captured: HookOutcome = {};

  const TestRoute = () => {
    const result = useUnsavedChanges({
      hasUnsavedChanges: opts.hasUnsavedChanges,
      onSaveAndLeave: opts.onSaveAndLeave,
      fallbackPath: '/dashboard',
    });
    captured.saveAndLeave = result.saveAndLeave;
    return null;
  };

  const router = createMemoryRouter(
    [
      { path: '/', element: <TestRoute /> },
      { path: '/dashboard', element: null },
    ],
    { initialEntries: ['/'] },
  );

  render(<RouterProvider router={router} />);
  return captured;
}

describe('useUnsavedChanges.saveAndLeave (Sprint 1 / C1.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not abort a save that takes longer than the old 5s ceiling', async () => {
    const slowSave = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
    );

    const captured = renderUseUnsavedChanges({
      hasUnsavedChanges: false,
      onSaveAndLeave: slowSave,
    });

    let outcome: { ok: boolean; error?: unknown } | undefined;
    await act(async () => {
      const pending = captured.saveAndLeave!();
      // Advance past the old 5s timeout — the new contract should NOT reject.
      await vi.advanceTimersByTimeAsync(6_000);
      // Continue advancing to let the slow save resolve.
      await vi.advanceTimersByTimeAsync(7_000);
      outcome = await pending;
    });

    expect(slowSave).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true });
  });

  it('still surfaces actual save failures without navigating away', async () => {
    const boom = new Error('Network error');
    const failingSave = vi.fn(() => Promise.reject(boom));

    const captured = renderUseUnsavedChanges({
      hasUnsavedChanges: false,
      onSaveAndLeave: failingSave,
    });

    let outcome: { ok: boolean; error?: unknown } | undefined;
    await act(async () => {
      outcome = await captured.saveAndLeave!();
    });

    expect(failingSave).toHaveBeenCalledTimes(1);
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toBe(boom);
  });
});
