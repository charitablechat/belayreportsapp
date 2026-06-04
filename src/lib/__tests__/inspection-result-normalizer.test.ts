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
  // P1 Sentry fix — legacy/imported wording reaching production sync.
  it('heals "not inspected" → na (NEVER pass/fail)', () => {
    expect(normalizeInspectionResult('not inspected')).toBe('na');
  });
  it('heals "Not Inspected" (case-insensitive)', () => {
    expect(normalizeInspectionResult('Not Inspected')).toBe('na');
  });
  it('heals " NOT  INSPECTED " (whitespace)', () => {
    expect(normalizeInspectionResult(' NOT  INSPECTED ')).toBe('na');
  });
  it('row normalizer heals systems result "not inspected"', () => {
    const out = normalizeResultFieldsOnRow({ id: '1', result: 'not inspected' });
    expect(out.changed).toBe(true);
    expect(out.row.result).toBe('na');
    expect(out.unknowns).toEqual([]);
  });
  it('row normalizer heals all four zipline result fields', () => {
    const out = normalizeResultFieldsOnRow({
      id: 'z1',
      result: 'not inspected',
      cable_result: 'not inspected',
      braking_result: 'not inspected',
      ead_result: 'not inspected',
    });
    expect(out.changed).toBe(true);
    expect(out.row.result).toBe('na');
    expect(out.row.cable_result).toBe('na');
    expect(out.row.braking_result).toBe('na');
    expect(out.row.ead_result).toBe('na');
  });
  it('array normalizer heals equipment row with "not inspected"', () => {
    const rows = [
      { id: 'e1', result: 'pass' },
      { id: 'e2', result: 'not inspected' },
    ];
    const out = normalizeResultFieldsOnRows(rows);
    expect(out.changed).toBe(true);
    expect(out.rows[1].result).toBe('na');
    expect(out.unknowns).toEqual([]);
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

describe('ROPEWORKS-6D — empty/whitespace result coercion', () => {
  it('coerces "" on a row to null and marks changed', () => {
    const { row, changed, unknowns } = normalizeResultFieldsOnRow({
      id: 'e1',
      equipment_type: 'Helmet',
      result: '',
    });
    expect(changed).toBe(true);
    expect(row.result).toBeNull();
    expect(unknowns).toEqual([]);
  });

  it('coerces whitespace-only ("   ") to null', () => {
    const { row, changed } = normalizeResultFieldsOnRow({ result: '   ' });
    expect(changed).toBe(true);
    expect(row.result).toBeNull();
  });

  it('coerces all four RESULT_FIELDS independently', () => {
    const { row, changed } = normalizeResultFieldsOnRow({
      result: '',
      cable_result: '',
      braking_result: 'pass',
      ead_result: '  ',
    });
    expect(changed).toBe(true);
    expect(row.result).toBeNull();
    expect(row.cable_result).toBeNull();
    expect(row.braking_result).toBe('pass');
    expect(row.ead_result).toBeNull();
  });

  it('reproduces the Sentry ROPEWORKS-6D shape (equipment array with empty results)', () => {
    const equipment = Array.from({ length: 16 }, (_, i) => ({
      id: `eq-${i}`,
      equipment_type: 'Harness',
      equipment_category: 'PPE',
      result: i === 14 || i === 15 ? '' : 'pass',
    }));
    const { rows, changed } = normalizeResultFieldsOnRows(equipment);
    expect(changed).toBe(true);
    expect(rows[14].result).toBeNull();
    expect(rows[15].result).toBeNull();
    expect(rows[0].result).toBe('pass');
  });

  it('leaves null and undefined untouched', () => {
    const { changed: c1 } = normalizeResultFieldsOnRow({ result: null });
    const { changed: c2 } = normalizeResultFieldsOnRow({ result: undefined });
    expect(c1).toBe(false);
    expect(c2).toBe(false);
  });
});
