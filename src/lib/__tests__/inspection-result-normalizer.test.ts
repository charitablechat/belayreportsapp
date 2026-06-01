import { describe, it, expect } from 'vitest';
import {
  normalizeInspectionResult,
  normalizeResultFieldsOnRow,
  normalizeResultFieldsOnRows,
  CANONICAL_RESULTS,
} from '../inspection-result-normalizer';

describe('normalizeInspectionResult — canonical values', () => {
  for (const v of CANONICAL_RESULTS) {
    it(`passes ${JSON.stringify(v)} through unchanged`, () => {
      expect(normalizeInspectionResult(v)).toBe(v);
    });
  }

  it('handles case variants of canonical values', () => {
    expect(normalizeInspectionResult('PASS')).toBe('pass');
    expect(normalizeInspectionResult('Pass ')).toBe('pass');
    expect(normalizeInspectionResult('Pass w/Provisions')).toBe('pass w/provisions');
    expect(normalizeInspectionResult('FAIL')).toBe('fail');
    expect(normalizeInspectionResult(' NA ')).toBe('na');
  });
});

describe('normalizeInspectionResult — legacy pass/rec family', () => {
  it('heals the exact ROPEWORKS-68 value pass/\\nrec', () => {
    expect(normalizeInspectionResult('pass/\nrec')).toBe('pass w/provisions');
  });
  it('heals pass/rec', () => {
    expect(normalizeInspectionResult('pass/rec')).toBe('pass w/provisions');
  });
  it('heals pass with recommendations', () => {
    expect(normalizeInspectionResult('pass with recommendations')).toBe('pass w/provisions');
  });
  it('heals conditional pass', () => {
    expect(normalizeInspectionResult('conditional pass')).toBe('pass w/provisions');
  });
  it('heals pass w provisions (no slash)', () => {
    expect(normalizeInspectionResult('pass w provisions')).toBe('pass w/provisions');
  });
  it('heals embedded tab/newline/whitespace variants', () => {
    expect(normalizeInspectionResult('pass /\t\nrec')).toBe('pass w/provisions');
    expect(normalizeInspectionResult('  PASS / Rec  ')).toBe('pass w/provisions');
  });
});

describe('normalizeInspectionResult — fail family (liability)', () => {
  it('heals failed → fail', () => {
    expect(normalizeInspectionResult('failed')).toBe('fail');
  });
  it('heals FAIL (severe) → fail', () => {
    expect(normalizeInspectionResult('fail (severe)')).toBe('fail');
  });
  // CRITICAL liability guard: fail/rec must never heal to pass w/provisions.
  it('heals fail/rec → fail (NEVER pass w/provisions)', () => {
    expect(normalizeInspectionResult('fail/rec')).toBe('fail');
  });
  it('heals fail/\\nrec → fail (NEVER pass w/provisions)', () => {
    expect(normalizeInspectionResult('fail/\nrec')).toBe('fail');
  });
});

describe('normalizeInspectionResult — n/a family', () => {
  it('heals n/a', () => {
    expect(normalizeInspectionResult('n/a')).toBe('na');
  });
  it('heals N / A', () => {
    expect(normalizeInspectionResult('N / A')).toBe('na');
  });
  it('heals not applicable', () => {
    expect(normalizeInspectionResult('not applicable')).toBe('na');
  });
});

describe('normalizeInspectionResult — empty / unknown → null', () => {
  it('returns null for empty string', () => {
    expect(normalizeInspectionResult('')).toBeNull();
  });
  it('returns null for whitespace-only', () => {
    expect(normalizeInspectionResult('   ')).toBeNull();
  });
  it('returns null for null/undefined', () => {
    expect(normalizeInspectionResult(null)).toBeNull();
    expect(normalizeInspectionResult(undefined)).toBeNull();
  });
  it('returns null for non-string', () => {
    expect(normalizeInspectionResult(42)).toBeNull();
    expect(normalizeInspectionResult({})).toBeNull();
  });
  it('returns null for genuinely unknown wording', () => {
    expect(normalizeInspectionResult('something weird')).toBeNull();
    expect(normalizeInspectionResult('maybe')).toBeNull();
  });
});

describe('normalizeResultFieldsOnRow', () => {
  it('returns the same reference when nothing changes', () => {
    const row = { id: '1', result: 'pass', system_name: 'X' };
    const out = normalizeResultFieldsOnRow(row);
    expect(out.row).toBe(row);
    expect(out.changed).toBe(false);
    expect(out.unknowns).toEqual([]);
  });

  it('heals legacy result fields and returns a new object', () => {
    const row = {
      id: '1',
      result: 'pass/\nrec',
      cable_result: 'PASS',
      braking_result: 'fail',
      ead_result: '',
    };
    const out = normalizeResultFieldsOnRow(row);
    expect(out.changed).toBe(true);
    expect(out.row).not.toBe(row);
    expect(out.row.result).toBe('pass w/provisions');
    expect(out.row.cable_result).toBe('pass');
    expect(out.row.braking_result).toBe('fail');
    expect(out.row.ead_result).toBe(''); // untouched (empty)
    // original not mutated
    expect(row.result).toBe('pass/\nrec');
  });

  it('reports unknown values without mutating them', () => {
    const row = { id: '1', result: 'something weird' };
    const out = normalizeResultFieldsOnRow(row);
    expect(out.changed).toBe(false);
    expect(out.row.result).toBe('something weird');
    expect(out.unknowns).toEqual([{ field: 'result', raw: 'something weird' }]);
  });

  it('truncates long unknowns to 32 chars', () => {
    const long = 'x'.repeat(100);
    const row = { id: '1', result: long };
    const out = normalizeResultFieldsOnRow(row);
    expect(out.unknowns[0].raw.length).toBe(32);
  });
});

describe('normalizeResultFieldsOnRows', () => {
  it('returns same array reference when no row changes', () => {
    const rows = [{ id: '1', result: 'pass' }, { id: '2', result: 'fail' }];
    const out = normalizeResultFieldsOnRows(rows);
    expect(out.rows).toBe(rows);
    expect(out.changed).toBe(false);
  });

  it('heals only the rows that need it', () => {
    const rows = [
      { id: '1', result: 'pass' },
      { id: '2', result: 'pass/\nrec' },
    ];
    const out = normalizeResultFieldsOnRows(rows);
    expect(out.changed).toBe(true);
    expect(out.rows).not.toBe(rows);
    expect(out.rows[0]).toBe(rows[0]); // untouched row reused
    expect(out.rows[1]).not.toBe(rows[1]);
    expect(out.rows[1].result).toBe('pass w/provisions');
  });

  it('aggregates unknowns with row indexes', () => {
    const rows = [
      { id: '1', result: 'pass' },
      { id: '2', result: 'wat' },
      { id: '3', result: 'huh', cable_result: 'pass' },
    ];
    const out = normalizeResultFieldsOnRows(rows);
    expect(out.unknowns).toEqual([
      { index: 1, field: 'result', raw: 'wat' },
      { index: 2, field: 'result', raw: 'huh' },
    ]);
  });
});
