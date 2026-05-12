/**
 * Lock the value-equality contract used by Dashboard.tsx to bail out of
 * SWR setState calls when the next array of rows is row-equivalent to
 * the previous one. See .lovable/plan.md "Root cause 2".
 *
 * sameRows is module-private inside Dashboard.tsx, so we re-implement it
 * here against the same DbRow shape and assert the four cases the plan
 * called out: identical, length-diff, id-diff, updated_at-diff. If the
 * Dashboard implementation drifts from this spec, the dashboard flicker
 * regression hunt should start by re-syncing this test.
 */
import { describe, it, expect } from 'vitest';
import type { DbRow } from '@/lib/offline-storage';

function sameRows(a: DbRow[], b: DbRow[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if ((a[i].updated_at ?? '') !== (b[i].updated_at ?? '')) return false;
  }
  return true;
}

const row = (id: string, updated_at: string): DbRow =>
  ({ id, updated_at } as unknown as DbRow);

describe('dashboard sameRows bail-out', () => {
  it('returns true for identical reference', () => {
    const a = [row('1', 't1')];
    expect(sameRows(a, a)).toBe(true);
  });

  it('returns true for value-identical arrays (different refs)', () => {
    expect(sameRows([row('1', 't1'), row('2', 't2')], [row('1', 't1'), row('2', 't2')]))
      .toBe(true);
  });

  it('returns false when length differs', () => {
    expect(sameRows([row('1', 't1')], [row('1', 't1'), row('2', 't2')])).toBe(false);
  });

  it('returns false when an id differs', () => {
    expect(sameRows([row('1', 't1')], [row('2', 't1')])).toBe(false);
  });

  it('returns false when an updated_at differs', () => {
    expect(sameRows([row('1', 't1')], [row('1', 't2')])).toBe(false);
  });

  it('treats missing updated_at as empty string', () => {
    const a = [{ id: '1' } as unknown as DbRow];
    const b = [{ id: '1', updated_at: '' } as unknown as DbRow];
    expect(sameRows(a, b)).toBe(true);
  });
});
