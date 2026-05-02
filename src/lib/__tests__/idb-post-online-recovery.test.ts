/**
 * Mode 6 — Tests for the post-online IDB-recovery grace window.
 *
 * Background: After Playwright/Chromium toggles `setOffline(true→false)` (or
 * a real cell-tower handoff returning to coverage), the first
 * `openDB('rope-works-inspections', 18)` has been observed to take >5s on
 * busy CI runners. Without a wider budget, the open exceeds the steady-state
 * 5s/8s timeout, `dbPromise` resets, the next caller starts a fresh open,
 * and every IDB op behind a boundary helper falls through to its `withTimeout`
 * fallback — a ~2-minute cascade where `getUnsynced*` returns `IdbReadFailure`
 * and the autosync drain has nothing to push (Mode 6 fingerprint:
 * `mode-6-idb-wedge-after-offline-toggle.md`).
 *
 * The fix stamps `lastOnlineRecoveryAt` from a `window.addEventListener('online', …)`
 * subscription. While `now - lastOnlineRecoveryAt < POST_ONLINE_RECOVERY_GRACE_MS`:
 *   - `selectIdbOpenTimeout(..., postOnlineRecovery=true)` returns the
 *     upgrade-grade budget (15s desktop / 20s mobile).
 *   - `applyPostOnlineGraceBump(timeoutMs)` returns `timeoutMs * 3`.
 *   - The three `withIndexedDB*Boundary` helpers wire `applyPostOnlineGraceBump`
 *     onto their per-op `OPERATION_TIMEOUT` so the outer race no longer
 *     fires before the underlying open/op can complete.
 *
 * After the grace expires, both helpers return their original values and
 * the H5 hung-IDB protection (5s steady-state desktop / 8s mobile + the
 * tier-defined boundary timeouts) is restored.
 *
 * Mode 7A — calibration update. Mode 6 set the grace window to 30s based
 * on PR #102 logs. PR #104's CI run showed the wedge can drag out for
 * 4-5min, so the 30s ceiling let grace expire while the storage layer
 * was still recovering. Bumped to 90s grace + 4× multiplier (was 3×) to
 * cover the observed P95 recovery curve. Old 3× expectations were updated
 * in-place; the 30s/3× values are no longer the contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectIdbOpenTimeout,
  applyPostOnlineGraceBump,
  isInPostOnlineRecoveryGrace,
  setLastOnlineRecoveryAtForTests,
} from '../offline-storage';

const DB_VERSION = 18;
// Mode 7A: 30_000 → 90_000
const POST_ONLINE_RECOVERY_GRACE_MS = 90_000;

describe('isInPostOnlineRecoveryGrace — Mode 6 grace-window predicate', () => {
  beforeEach(() => {
    // Reset to the "no online event has ever fired" state so each test starts
    // from a known baseline. Module-level state would otherwise leak between
    // tests in the same suite (vitest runs them sequentially in one worker).
    setLastOnlineRecoveryAtForTests(0);
  });

  it('returns false when no `online` event has ever fired', () => {
    expect(isInPostOnlineRecoveryGrace(Date.now())).toBe(false);
  });

  it('returns true at t=0 (just-fired event, used as the `now` argument)', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_000)).toBe(true);
  });

  it('returns true 1ms after the event', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_001)).toBe(true);
  });

  it('returns true at the lower edge (89_999ms after)', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_000 + POST_ONLINE_RECOVERY_GRACE_MS - 1)).toBe(true);
  });

  it('returns false at the upper edge (exactly 90_000ms after — Mode 7A calibration)', () => {
    // Strict-less-than semantics: at the boundary, the grace window has
    // closed. Documents the contract so a future change to `<=` would
    // surface here loudly.
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_000 + POST_ONLINE_RECOVERY_GRACE_MS)).toBe(false);
  });

  it('returns true 60s after the event (still inside the 90s window — Mode 7A)', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_000 + 60_000)).toBe(true);
  });

  it('returns false 120s after the event (well past the 90s window)', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_000 + 120_000)).toBe(false);
  });

  it('does NOT consider system clock skew that produces a `now` BEFORE the stamp', () => {
    // Defensive: if `Date.now()` runs backward (NTP correction, suspended VM
    // resuming, etc.) we shouldn't accidentally claim the grace window is
    // open forever. `now - stamp` would be negative; `< POST_ONLINE_RECOVERY_GRACE_MS`
    // would be true; but that's fine because a negative value still means
    // "we are still inside the original 30s window from the stamp's
    // perspective". The contract is: "is the wall-clock close to the
    // observed online edge?" — `now=stamp-100` is just as close as `now=stamp+100`.
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(999_900)).toBe(true);
  });
});

describe('applyPostOnlineGraceBump — Mode 6 boundary multiplier', () => {
  beforeEach(() => {
    setLastOnlineRecoveryAtForTests(0);
  });

  it('returns the input unchanged outside the grace window', () => {
    // No event yet — `isInPostOnlineRecoveryGrace` is false.
    expect(applyPostOnlineGraceBump(5_000)).toBe(5_000);
    expect(applyPostOnlineGraceBump(10_000)).toBe(10_000);
    expect(applyPostOnlineGraceBump(8_000)).toBe(8_000);
  });

  it('returns 4× the input inside the grace window (Mode 7A: was 3×) — covers all four IDB_TIMEOUTS tiers', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    // Pass `now` aligned with the stamp so the predicate fires.
    expect(applyPostOnlineGraceBump(5_000, 1_000_000)).toBe(20_000);  // light
    expect(applyPostOnlineGraceBump(10_000, 1_000_000)).toBe(40_000); // batch
    expect(applyPostOnlineGraceBump(8_000, 1_000_000)).toBe(32_000);  // write
    expect(applyPostOnlineGraceBump(15_000, 1_000_000)).toBe(60_000); // heavy
  });

  it('returns the input unchanged once the grace window has expired', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(applyPostOnlineGraceBump(5_000, 1_000_000 + POST_ONLINE_RECOVERY_GRACE_MS + 1)).toBe(5_000);
    expect(applyPostOnlineGraceBump(10_000, 1_000_000 + POST_ONLINE_RECOVERY_GRACE_MS + 1)).toBe(10_000);
  });

  it('preserves zero (no division-by-zero or NaN paths)', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(applyPostOnlineGraceBump(0, 1_000_000)).toBe(0);
  });

  it('rejects nothing — multiplies negative budgets too (defensive)', () => {
    // Not a real-world input, but pin the contract: pure arithmetic, no
    // hidden clamping or sign-handling. If a future refactor introduces a
    // signed budget by accident, the test will surface immediately.
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(applyPostOnlineGraceBump(-1_000, 1_000_000)).toBe(-4_000);
  });
});

describe('selectIdbOpenTimeout — postOnlineRecovery 4th argument (Mode 6)', () => {
  it('returns 15_000ms on desktop steady-state when postOnlineRecovery=true', () => {
    // Without the flag, this would return the steady-state 5_000.
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false, true)).toBe(15_000);
  });

  it('returns 20_000ms on mobile steady-state when postOnlineRecovery=true', () => {
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, true, true)).toBe(20_000);
  });

  it('returns 5_000ms on desktop steady-state when postOnlineRecovery=false', () => {
    // Original Mode 1 contract preserved when the flag is omitted/false.
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false, false)).toBe(5_000);
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false)).toBe(5_000);
  });

  it('returns 8_000ms on mobile steady-state when postOnlineRecovery=false', () => {
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, true, false)).toBe(8_000);
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, true)).toBe(8_000);
  });

  it('returns the upgrade-grade budget on the upgrade path regardless of postOnlineRecovery', () => {
    // The upgrade branch wins — once we're upgrading, the budget is
    // already at the maximum (15s/20s). The Mode 6 flag doesn't escalate
    // beyond that.
    expect(selectIdbOpenTimeout(0, DB_VERSION, false, true)).toBe(15_000);
    expect(selectIdbOpenTimeout(0, DB_VERSION, true, true)).toBe(20_000);
    expect(selectIdbOpenTimeout(15, DB_VERSION, false, true)).toBe(15_000);
    expect(selectIdbOpenTimeout(15, DB_VERSION, true, true)).toBe(20_000);
  });

  it('treats degenerate `existingVersion` (NaN/Infinity/negative) as upgrade regardless of postOnlineRecovery', () => {
    // Fail-safe: if `detectExistingDBVersion` produces a malformed value,
    // we always grant the upgrade-grade budget. The Mode 6 flag is
    // redundant here but does not change the result.
    expect(selectIdbOpenTimeout(Number.NaN, DB_VERSION, false, true)).toBe(15_000);
    expect(selectIdbOpenTimeout(Number.NaN, DB_VERSION, false, false)).toBe(15_000);
    expect(selectIdbOpenTimeout(Number.POSITIVE_INFINITY, DB_VERSION, true, true)).toBe(20_000);
    expect(selectIdbOpenTimeout(-1, DB_VERSION, false, true)).toBe(15_000);
  });

  it('does not regress the 3-arg call shape — backward compatible with all pre-Mode-6 callers', () => {
    // Important: the Mode 6 fix MUST NOT break the prior contract. All
    // existing callers using the 3-arg form (pre-Mode-6) still get the
    // steady-state 5s/8s budget at steady state and the upgrade 15s/20s
    // budget on upgrade — no behavior change.
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false)).toBe(5_000);
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, true)).toBe(8_000);
    expect(selectIdbOpenTimeout(0, DB_VERSION, false)).toBe(15_000);
    expect(selectIdbOpenTimeout(15, DB_VERSION, true)).toBe(20_000);
  });
});

describe('Mode 6+7A contract — boundary bump and open-side bump fire on the same predicate', () => {
  beforeEach(() => {
    setLastOnlineRecoveryAtForTests(0);
  });

  it('boundary bump and open-side bump both fire only when the predicate is true', () => {
    // Outside grace: boundary returns input; open returns steady-state.
    expect(applyPostOnlineGraceBump(5_000)).toBe(5_000);
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false, isInPostOnlineRecoveryGrace())).toBe(5_000);

    // Inside grace: boundary multiplies by 4 (Mode 7A); open returns upgrade-grade.
    setLastOnlineRecoveryAtForTests(Date.now());
    expect(applyPostOnlineGraceBump(5_000)).toBe(20_000);
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false, isInPostOnlineRecoveryGrace())).toBe(15_000);
  });

  it('boundary bump exceeds the open-side ceiling (Mode 7A: was 1× alignment, now 1.33×)', () => {
    // Mode 7A intentionally widens the boundary multiplier (4×) above the
    // open-side upgrade-grade ceiling (15s desktop). Rationale: the open
    // call is one-shot per `dbPromise` lifetime; the boundary races every
    // per-op call (read/write) inside that connection. Per-op slowness
    // observed in CI persists past the moment the open completed, so the
    // boundary needs MORE headroom than the open. The two values are no
    // longer expected to match; this test pins the new asymmetric design.
    setLastOnlineRecoveryAtForTests(1_000_000);
    const boundaryDuringGrace = applyPostOnlineGraceBump(5_000, 1_000_000);
    const openDuringGrace = selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false, true);
    expect(boundaryDuringGrace).toBe(20_000);
    expect(openDuringGrace).toBe(15_000);
    expect(boundaryDuringGrace).toBeGreaterThan(openDuringGrace);
  });
});
