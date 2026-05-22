/**
 * Locks the Training Report PDF print-CSS contract.
 *
 * These assertions read the generate-training-html edge function source as
 * a string and verify that the @media print block carries the Riverbend-
 * style compact layout AND that the scoped page-break rule cannot regress
 * into a global `h2 { page-break-before: always }` (which would create
 * blank first pages / page explosion).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../../../supabase/functions/generate-training-html/index.ts'),
  'utf8',
);

// Extract just the @media print { ... } block so assertions can't accidentally
// match web-view CSS (the outer stylesheet also defines .page, .section, etc).
function extractPrintBlock(src: string): string {
  const start = src.indexOf('@media print');
  expect(start, '@media print block must exist in training html source').toBeGreaterThan(-1);
  let depth = 0;
  let i = src.indexOf('{', start);
  const blockStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(blockStart, i + 1);
    }
  }
  throw new Error('Unterminated @media print block');
}

const PRINT_BLOCK = extractPrintBlock(SRC);

describe('Training Report PDF print CSS — Riverbend compact contract', () => {
  it('uses tightened @page margins (0.25in / 0.35in bottom)', () => {
    expect(PRINT_BLOCK).toMatch(/@page\s*\{[^}]*margin:\s*0\.25in\s+0\.25in\s+0\.35in\s+0\.25in/);
  });

  it('drops .page min-height so short sections do not create near-blank pages', () => {
    // The old sparse layout used min-height: 10.5in. Riverbend-style must NOT.
    expect(PRINT_BLOCK).not.toMatch(/min-height:\s*10\.5in/);
    expect(PRINT_BLOCK).toMatch(/\.page\s*\{[^}]*min-height:\s*0\s*!important/);
  });

  it('scopes the major-section page-break to .page + .page (not global h2)', () => {
    expect(PRINT_BLOCK).toMatch(/\.page\s*\+\s*\.page\s*\{[^}]*break-before:\s*page/);
    expect(PRINT_BLOCK).toMatch(/\.page\s*\+\s*\.page\s*\{[^}]*page-break-before:\s*always/);
  });

  it('prevents a blank first page via .page:first-of-type override', () => {
    expect(PRINT_BLOCK).toMatch(/\.page:first-of-type\s*\{[^}]*page-break-before:\s*avoid/);
  });

  it('does NOT contain a global h2 { page-break-before: always } rule', () => {
    // Either inside or outside the print block — this would defeat the scoping.
    expect(SRC).not.toMatch(/(^|\W)h2\s*\{[^}]*page-break-before:\s*always/);
  });

  it('applies compact section-title typography in print only (≤ 13pt)', () => {
    expect(PRINT_BLOCK).toMatch(/\.section-title\s*\{[^}]*font-size:\s*12\.5pt\s*!important/);
  });

  it('compacts info-grid gap and list spacing', () => {
    expect(PRINT_BLOCK).toMatch(/\.info-grid\s*\{[^}]*gap:\s*4px\s+16px\s*!important/);
    expect(PRINT_BLOCK).toMatch(/\bli\s*\{[^}]*padding:\s*2px\s+0\s*!important/);
  });

  it('shrinks photo tiles so single-photo galleries do not waste a page', () => {
    expect(PRINT_BLOCK).toMatch(/\.photo-grid\s+img\s*\{[^}]*max-height:\s*165px\s*!important/);
  });
});
