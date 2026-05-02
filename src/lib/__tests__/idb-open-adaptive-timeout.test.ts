/**
 * Tests for `selectIdbOpenTimeout` — the adaptive IDB-open budget used by
 * `getDB()` to size the `Promise.race` between `openDB(DB_NAME, DB_VERSION)`
 * and the watchdog timer.
 *
 * Background: the steady-state 5s desktop budget was right on the edge of
 * the cold-start v0 → v18 upgrade chain on busy CI runners (~14 stores +
 * ~30 indexes + 3 dirty-flag backfills + post-upgrade fingerprint), which
 * surfaced as a "Mode 1" flake on `offline-edit-reconcile.spec.ts:141` —
 * the inspection never reached IDB → autosync queue empty → never synced
 * → 30s test timeout. The adaptive helper widens the budget only on the
 * upgrade path, preserving the original H5 hung-IDB protection (5s/8s
 * fail-fast) for the dominant returning-user case.
 *
 * The contract pinned here:
 *   - existingVersion === dbVersion (steady state) → 5_000ms desktop / 8_000ms mobile
 *   - existingVersion <  dbVersion (upgrade path) → 15_000ms desktop / 20_000ms mobile
 *   - existingVersion === 0       (fresh install) → upgrade-path budgets
 *   - non-finite (NaN/Infinity)                  → upgrade-path budgets (fail-safe)
 *
 * If a future change loosens or tightens any of these branches, the
 * matching test below will fail loudly with the prior contract intact.
 */

import { describe, it, expect } from 'vitest';
import { selectIdbOpenTimeout } from '../offline-storage';

const DB_VERSION = 18;

describe('selectIdbOpenTimeout — steady state (existingVersion === DB_VERSION)', () => {
  it('returns 5_000 ms on desktop', () => {
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false)).toBe(5_000);
  });

  it('returns 8_000 ms on mobile', () => {
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, true)).toBe(8_000);
  });

  it('does not regress as DB_VERSION changes — equality, not the literal number, drives the steady-state branch', () => {
    expect(selectIdbOpenTimeout(99, 99, false)).toBe(5_000);
    expect(selectIdbOpenTimeout(99, 99, true)).toBe(8_000);
  });
});

describe('selectIdbOpenTimeout — fresh install (existingVersion === 0)', () => {
  it('returns 15_000 ms on desktop (cold-start v0 → v18 upgrade headroom)', () => {
    expect(selectIdbOpenTimeout(0, DB_VERSION, false)).toBe(15_000);
  });

  it('returns 20_000 ms on mobile (Safari bfcache + iPad cold boot compounds)', () => {
    expect(selectIdbOpenTimeout(0, DB_VERSION, true)).toBe(20_000);
  });
});

describe('selectIdbOpenTimeout — multi-version upgrade (0 < existingVersion < DB_VERSION)', () => {
  it('returns 15_000 ms on desktop when user on v15 hits a v18-schema build', () => {
    expect(selectIdbOpenTimeout(15, DB_VERSION, false)).toBe(15_000);
  });

  it('returns 20_000 ms on mobile when user on v15 hits a v18-schema build', () => {
    expect(selectIdbOpenTimeout(15, DB_VERSION, true)).toBe(20_000);
  });

  it('treats one-step upgrades the same as multi-step (no special-casing)', () => {
    expect(selectIdbOpenTimeout(DB_VERSION - 1, DB_VERSION, false)).toBe(15_000);
    expect(selectIdbOpenTimeout(DB_VERSION - 1, DB_VERSION, true)).toBe(20_000);
  });
});

describe('selectIdbOpenTimeout — fail-safe on degenerate inputs', () => {
  it('falls through to the upgrade-path budget when existingVersion is NaN', () => {
    // NaN can leak in if `detectExistingDBVersion` returns from a malformed
    // path. The conservative thing is to assume an upgrade might be needed
    // and let the open complete rather than fail-fast at 5s.
    expect(selectIdbOpenTimeout(Number.NaN, DB_VERSION, false)).toBe(15_000);
    expect(selectIdbOpenTimeout(Number.NaN, DB_VERSION, true)).toBe(20_000);
  });

  it('falls through to the upgrade-path budget when existingVersion is Infinity', () => {
    expect(selectIdbOpenTimeout(Number.POSITIVE_INFINITY, DB_VERSION, false)).toBe(15_000);
    expect(selectIdbOpenTimeout(Number.NEGATIVE_INFINITY, DB_VERSION, true)).toBe(20_000);
  });

  it('falls through to the upgrade-path budget when existingVersion is negative', () => {
    // Shouldn't happen in practice — `detectExistingDBVersion` returns 0
    // when the DB is absent — but pin the branch so a future refactor
    // returning -1 as a sentinel doesn't accidentally use the fail-fast
    // budget on a path that needs more headroom.
    expect(selectIdbOpenTimeout(-1, DB_VERSION, false)).toBe(15_000);
  });
});

describe('selectIdbOpenTimeout — H5 hung-IDB protection preserved at steady state', () => {
  it('steady-state desktop budget is unchanged from the pre-RC4 contract', () => {
    // This is the explicit anchor for the H5 hung-IDB protection rationale
    // documented in src/lib/offline-storage.ts (RC-3 comment). The fail-fast
    // budget for desktop steady-state remains 5s. If a future change to
    // selectIdbOpenTimeout loosens this, it should be a deliberate decision
    // accompanied by a corresponding update to this assertion and a fresh
    // analysis of hung-IDB recovery behaviour — not an accidental bump.
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, false)).toBe(5_000);
  });

  it('steady-state mobile budget is unchanged from the pre-RC4 contract', () => {
    // Same anchor as above for the mobile branch (8s, set in RC-3 for
    // Safari bfcache restore + iPad cold boot).
    expect(selectIdbOpenTimeout(DB_VERSION, DB_VERSION, true)).toBe(8_000);
  });
});
