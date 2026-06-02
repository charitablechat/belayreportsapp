/**
 * Contract test: public/sw-sync.js `swNormalizeInspectionResult` MUST stay
 * in lockstep with src/lib/inspection-result-normalizer.ts.
 *
 * The service worker cannot import TS modules, so the rules are duplicated.
 * This test reads the SW file, extracts the function via a tagged regex,
 * evaluates it in an isolated scope, and asserts the same canonical mapping
 * for the values that matter (including the P1 "not inspected" → "na" fix).
 *
 * No DOM, no IDB, no network. Pure string-in / string-out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeInspectionResult } from '../inspection-result-normalizer';

function loadSwNormalizer(): (raw: unknown) => string | null {
  const swPath = resolve(__dirname, '../../../public/sw-sync.js');
  const src = readFileSync(swPath, 'utf8');
  const match = src.match(
    /function\s+swNormalizeInspectionResult\s*\([\s\S]*?\n\}/,
  );
  if (!match) {
    throw new Error('swNormalizeInspectionResult not found in public/sw-sync.js');
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(
    `${match[0]}; return swNormalizeInspectionResult;`,
  );
  return factory() as (raw: unknown) => string | null;
}

const swNormalize = loadSwNormalizer();

describe('SW mirror — swNormalizeInspectionResult', () => {
  // Canonical values pass through.
  for (const v of ['pass', 'pass w/provisions', 'fail', 'na'] as const) {
    it(`passes ${JSON.stringify(v)} through unchanged`, () => {
      expect(swNormalize(v)).toBe(v);
    });
  }

  it('P1 fix: "not inspected" → na', () => {
    expect(swNormalize('not inspected')).toBe('na');
  });
  it('P1 fix: "Not Inspected" (case)', () => {
    expect(swNormalize('Not Inspected')).toBe('na');
  });
  it('P1 fix: " NOT  INSPECTED " (whitespace)', () => {
    expect(swNormalize(' NOT  INSPECTED ')).toBe('na');
  });

  // Liability guards must remain identical to TS normalizer.
  it('fail/rec → fail (never pass w/provisions)', () => {
    expect(swNormalize('fail/rec')).toBe('fail');
  });
  it('pass/rec → pass w/provisions', () => {
    expect(swNormalize('pass/rec')).toBe('pass w/provisions');
  });
  it('unknown wording returns null', () => {
    expect(swNormalize('something weird')).toBeNull();
  });

  // Cross-check: for every value in this matrix, SW output === TS output.
  const matrix = [
    'pass', 'PASS', 'Pass ',
    'pass w/provisions', 'Pass w/Provisions',
    'fail', 'failed', 'fail/rec',
    'na', 'n/a', 'N / A', 'not applicable', 'not inspected', 'Not Inspected',
    'pass/rec', 'pass/\nrec', 'pass with recommendations', 'conditional pass',
    '', '   ', 'something weird',
  ];
  for (const v of matrix) {
    it(`SW and TS agree on ${JSON.stringify(v)}`, () => {
      expect(swNormalize(v)).toBe(normalizeInspectionResult(v));
    });
  }
});
