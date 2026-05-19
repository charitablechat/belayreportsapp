import { describe, it, expect, vi } from 'vitest';
import { trackChildDeletions } from '../track-child-deletions';

interface Row { id?: string; name?: string }

const makeRef = () => ({ current: new Set<string>() });

const captureSetter = () => {
  let state: Row[] = [];
  const setter = vi.fn((action: Row[] | ((p: Row[]) => Row[])) => {
    state = typeof action === 'function' ? (action as (p: Row[]) => Row[])(state) : action;
  });
  return { setter, get: () => state, seed: (v: Row[]) => { state = v; } };
};

describe('trackChildDeletions', () => {
  it('adds removed non-temp ids to the ref when state shrinks', () => {
    const ref = makeRef();
    const { setter, seed, get } = captureSetter();
    seed([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const wrapped = trackChildDeletions<Row>(setter, ref);
    wrapped(prev => prev.filter(r => r.id !== 'b'));
    expect(get().map(r => r.id)).toEqual(['a', 'c']);
    expect([...ref.current]).toEqual(['b']);
  });

  it('does NOT track temp-* ids (never been on the server)', () => {
    const ref = makeRef();
    const { setter, seed } = captureSetter();
    seed([{ id: 'temp-1' }, { id: 'real-1' }]);
    const wrapped = trackChildDeletions<Row>(setter, ref);
    wrapped(prev => prev.filter(r => r.id !== 'temp-1'));
    expect([...ref.current]).toEqual([]);
  });

  it('does NOT track when state stays the same length (edit, not delete)', () => {
    const ref = makeRef();
    const { setter, seed } = captureSetter();
    seed([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const wrapped = trackChildDeletions<Row>(setter, ref);
    wrapped(prev => prev.map(r => r.id === 'a' ? { ...r, name: 'A2' } : r));
    expect([...ref.current]).toEqual([]);
  });

  it('does NOT track non-functional updates (programmatic state replacement)', () => {
    // Critical contract: server reconciles, JSON imports, and other
    // wholesale state replacements call the RAW setter directly. The
    // wrapped setter should never inflate the deletion ref on value-form
    // updates, even if the new value happens to be shorter.
    const ref = makeRef();
    const { setter, seed } = captureSetter();
    seed([{ id: 'a' }, { id: 'b' }]);
    const wrapped = trackChildDeletions<Row>(setter, ref);
    wrapped([{ id: 'a' }]); // value-form, shorter
    expect([...ref.current]).toEqual([]);
  });

  it('handles multiple deletions in a single update', () => {
    const ref = makeRef();
    const { setter, seed } = captureSetter();
    seed([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    const wrapped = trackChildDeletions<Row>(setter, ref);
    wrapped(prev => prev.filter(r => r.id === 'a' || r.id === 'd'));
    expect([...ref.current].sort()).toEqual(['b', 'c']);
  });
});
