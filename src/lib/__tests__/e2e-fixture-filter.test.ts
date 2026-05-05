import { describe, expect, it } from 'vitest';
import {
  E2E_INSPECTION_MARKER_COLUMNS,
  E2E_MARKER_PREFIX,
  filterOutE2EFixtures,
  isE2EFixtureRecord,
} from '../e2e-fixture-filter';

describe('e2e-fixture-filter', () => {
  describe('isE2EFixtureRecord', () => {
    it('returns true when location starts with marker prefix', () => {
      expect(
        isE2EFixtureRecord(
          { location: `${E2E_MARKER_PREFIX} 1700000000000`, organization: 'Real Org' },
          E2E_INSPECTION_MARKER_COLUMNS
        )
      ).toBe(true);
    });

    it('returns true when organization starts with marker prefix', () => {
      expect(
        isE2EFixtureRecord(
          { location: 'Real Location', organization: `${E2E_MARKER_PREFIX} 1700000000000` },
          E2E_INSPECTION_MARKER_COLUMNS
        )
      ).toBe(true);
    });

    it('returns false for genuine records', () => {
      expect(
        isE2EFixtureRecord(
          { location: 'Camp TexLake', organization: 'Belay Reports' },
          E2E_INSPECTION_MARKER_COLUMNS
        )
      ).toBe(false);
    });

    it('is case-insensitive (matches PostgREST ilike)', () => {
      expect(
        isE2EFixtureRecord(
          { location: '[e2e devin] lowercase', organization: '' },
          E2E_INSPECTION_MARKER_COLUMNS
        )
      ).toBe(true);
    });

    it('returns false when columns are absent or non-string', () => {
      expect(
        isE2EFixtureRecord(
          { location: null, organization: undefined },
          E2E_INSPECTION_MARKER_COLUMNS
        )
      ).toBe(false);
      expect(
        isE2EFixtureRecord({ location: 42, organization: {} }, E2E_INSPECTION_MARKER_COLUMNS)
      ).toBe(false);
    });

    it('returns false for null/undefined row', () => {
      expect(isE2EFixtureRecord(null, E2E_INSPECTION_MARKER_COLUMNS)).toBe(false);
      expect(isE2EFixtureRecord(undefined, E2E_INSPECTION_MARKER_COLUMNS)).toBe(false);
    });

    it('does NOT match marker mid-string — only prefix counts', () => {
      expect(
        isE2EFixtureRecord(
          { location: 'About [E2E DEVIN] something', organization: '' },
          E2E_INSPECTION_MARKER_COLUMNS
        )
      ).toBe(false);
    });
  });

  describe('filterOutE2EFixtures', () => {
    it('removes only marker-prefixed rows, preserves order', () => {
      const rows = [
        { id: 'a', location: 'Camp TexLake', organization: 'Belay Reports' },
        { id: 'b', location: `${E2E_MARKER_PREFIX} 1`, organization: '' },
        { id: 'c', location: 'Real Site', organization: 'Real Org' },
        { id: 'd', location: 'X', organization: `${E2E_MARKER_PREFIX} 2` },
      ];
      const filtered = filterOutE2EFixtures(rows, E2E_INSPECTION_MARKER_COLUMNS);
      expect(filtered.map((r) => r.id)).toEqual(['a', 'c']);
    });

    it('returns empty array when all rows are marked', () => {
      const rows = [
        { id: '1', location: `${E2E_MARKER_PREFIX} a`, organization: '' },
        { id: '2', location: `${E2E_MARKER_PREFIX} b`, organization: '' },
      ];
      expect(filterOutE2EFixtures(rows, E2E_INSPECTION_MARKER_COLUMNS)).toEqual([]);
    });

    it('returns input unchanged when nothing is marked', () => {
      const rows = [
        { id: '1', location: 'Camp', organization: 'Org' },
        { id: '2', location: 'Summit', organization: 'Org' },
      ];
      expect(filterOutE2EFixtures(rows, E2E_INSPECTION_MARKER_COLUMNS)).toEqual(rows);
    });
  });
});
