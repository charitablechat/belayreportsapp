/**
 * Phase 1 — structural read-only guardrail for the training recovery scanner.
 *
 * Two checks:
 *  1. The scanner source contains NO write tokens (db.put, db.delete,
 *     .insert(, .update(, .upsert(, .delete(, clear(, .from(...).insert,
 *     .from(...).update, etc.). This protects against an inadvertent
 *     edit later adding a write path.
 *  2. The scanner imports ONLY from a known read-only allowlist. This
 *     keeps the module structurally separate from save / sync / restore
 *     modules so it cannot accidentally pull in a writer.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCANNER_PATH = join(
  process.cwd(),
  'src/lib/recovery/training-recovery-scan.ts',
);

const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'db.put', re: /\bdb\.put\b/ },
  { name: 'db.delete', re: /\bdb\.delete\b/ },
  { name: 'db.add', re: /\bdb\.add\b/ },
  { name: 'db.clear', re: /\bdb\.clear\b/ },
  { name: '.put(', re: /\bstore\.put\b/ },
  { name: '.insert(', re: /\.insert\s*\(/ },
  { name: '.update(', re: /\.update\s*\(/ },
  { name: '.upsert(', re: /\.upsert\s*\(/ },
  { name: '.delete(', re: /\.delete\s*\(/ },
  { name: '.clear(', re: /\.clear\s*\(/ },
  { name: 'localStorage.setItem', re: /localStorage\.setItem/ },
  { name: 'localStorage.removeItem', re: /localStorage\.removeItem/ },
  { name: 'sessionStorage.setItem', re: /sessionStorage\.setItem/ },
];

const ALLOWED_IMPORTS: ReadonlyArray<string> = [
  '@/lib/offline-storage',
  '@/lib/report-version-manager',
];

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'form-savers', re: /from\s+['"][^'"]*form-savers[^'"]*['"]/ },
  { name: 'sync-manager', re: /from\s+['"][^'"]*\/sync[-/][^'"]+['"]/ },
  { name: 'atomic-sync-manager', re: /atomic-sync-manager/ },
  { name: 'admin-edit-snapshot (write paths)', re: /from\s+['"][^'"]*admin-edit-snapshot['"]/ },
  { name: 'supabase client', re: /from\s+['"][^'"]*integrations\/supabase\/client['"]/ },
];

describe('training-recovery-scan is structurally read-only', () => {
  const source = readFileSync(SCANNER_PATH, 'utf8');

  for (const { name, re } of FORBIDDEN_PATTERNS) {
    it(`does not contain write token: ${name}`, () => {
      expect(source).not.toMatch(re);
    });
  }

  for (const { name, re } of FORBIDDEN_IMPORT_PATTERNS) {
    it(`does not import: ${name}`, () => {
      expect(source).not.toMatch(re);
    });
  }

  it('only imports from the read-only allowlist', () => {
    const importRe = /from\s+['"]([^'"]+)['"]/g;
    const imports: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(source)) !== null) {
      imports.push(m[1]);
    }
    for (const spec of imports) {
      // Allow relative node built-ins or same-dir helpers if any are added later.
      if (spec.startsWith('node:')) continue;
      expect(
        ALLOWED_IMPORTS.includes(spec),
        `unexpected import "${spec}" in read-only scanner`,
      ).toBe(true);
    }
  });
});
