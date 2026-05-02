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
 * The 30s grace window is calibrated against the wedge fingerprint observed
 * in CI run 25247813479: the storage layer recovered between 08:25:25 (first
 * 5s open timeout) and 08:27:35 (drop back to 2s storage-tier timeouts) —
 * ~2:10 minutes from edge to recovery, but most of the IDB-op timeouts
 * cluster in the first 60s. 30s of grace gives the open path one solid
 * upgrade-grade attempt; if THAT still times out, we're back on the
 * steady-state recovery path with the same semantics as before.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectIdbOpenTimeout,
  applyPostOnlineGraceBump,
  isInPostOnlineRecoveryGrace,
  setLastOnlineRecoveryAtForTests,
} from '../offline-storage';

const DB_VERSION = 18;
const POST_ONLINE_RECOVERY_GRACE_MS = 30_000;

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

  it('returns true at the lower edge (29_999ms after)', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_000 + POST_ONLINE_RECOVERY_GRACE_MS - 1)).toBe(true);
  });

  it('returns false at the upper edge (exactly 30_000ms after)', () => {
    // Strict-less-than semantics: at the boundary, the grace window has
    // closed. Documents the contract so a future change to `<=` would
    // surface here loudly.
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_000 + POST_ONLINE_RECOVERY_GRACE_MS)).toBe(false);
  });

  it('returns false long after (60s)', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(isInPostOnlineRecoveryGrace(1_000_000 + 60_000)).toBe(false);
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

  it('returns 3× the input inside the grace window — covers all four IDB_TIMEOUTS tiers', () => {
    setLastOnlineRecoveryAtForTests(1_000_000);
    // Pass `now` aligned with the stamp so the predicate fires.
    expect(applyPostOnlineGraceBump(5_000, 1_000_000)).toBe(15_000);  // light
    expect(applyPostOnlineGraceBump(10_000, 1_000_000)).toBe(30_000); // batch
    expect(applyPostOnlineGraceBump(8_000, 1_000_000)).toBe(24_000);  // write
    expect(applyPostOnlineGraceBump(15_000, 1_000_000)).toBe(45_000); // heavy
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
    expect(applyPostOnlineGraceBump(-1_000, 1_000_000)).toBe(-3_000);
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

describe('Mode 6 contract — boundary bump matches open-side bump', () => {
  beforeEach(() => {
    setLastOnlineRecoveryAtForTests(0);
  });

  it('boundary bump and open-side bump both fire only when the predicate is true', () => {
    // Outside grace: boundary returns input; open returns steady-state.
    expect(applyPostOnlineGraceBump(5_000)).toBe(5_000);
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false, isInPostOnlineRecoveryGrace())).toBe(5_000);

    // Inside grace: boundary multiplies by 3; open returns upgrade-grade.
    setLastOnlineRecoveryAtForTests(Date.now());
    expect(applyPostOnlineGraceBump(5_000)).toBe(15_000);
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false, isInPostOnlineRecoveryGrace())).toBe(15_000);
  });

  it('boundary bump (3×) and open-side bump (5_000→15_000) produce the same desktop ceiling', () => {
    // The two independent paths converge on 15_000ms during the grace
    // window — that's the design intent: boundary-side `light` (5s) → 15s
    // matches the open-side steady → upgrade-grade (15s desktop). If
    // either side drifts (e.g. a future change makes `light` 7s), this
    // test surfaces the drift immediately.
    setLastOnlineRecoveryAtForTests(1_000_000);
    expect(applyPostOnlineGraceBump(5_000, 1_000_000)).toBe(
      selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false, true)
    );
  });
});
