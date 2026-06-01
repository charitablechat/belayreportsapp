/**
 * Structural read-only guardrail for the permanent Recovery & Sync Health page
 * and the local-report-index helper.
 *
 * Asserts neither file contains write tokens (db.put, .insert(, .update(,
 * .upsert(, .delete(, .clear(, localStorage.setItem, etc.) and neither
 * imports a known writer module (form-savers, sync-manager, atomic-sync-manager,
 * admin-edit-snapshot).
 *
 * The page IS allowed to import @/integrations/supabase/client because the
 * server enrichment uses RLS-scoped SELECT only; the regex below enforces that
 * no .insert/.update/.upsert/.delete chains are present.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/pages/RecoveryAndSyncHealth.tsx',
  'src/lib/recovery/local-report-index.ts',
];

const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'db.put', re: /\bdb\.put\b/ },
  { name: 'db.delete', re: /\bdb\.delete\b/ },
  { name: 'db.add', re: /\bdb\.add\b/ },
  { name: 'db.clear', re: /\bdb\.clear\b/ },
  { name: 'store.put', re: /\bstore\.put\b/ },
  { name: '.insert(', re: /\.insert\s*\(/ },
  { name: '.update(', re: /\.update\s*\(/ },
  { name: '.upsert(', re: /\.upsert\s*\(/ },
  { name: '.delete(', re: /\.delete\s*\(/ },
  { name: '.clear(', re: /\.clear\s*\(/ },
  { name: 'localStorage.setItem', re: /localStorage\.setItem/ },
  { name: 'localStorage.removeItem', re: /localStorage\.removeItem/ },
  { name: 'sessionStorage.setItem', re: /sessionStorage\.setItem/ },
  { name: 'service-worker.update', re: /registration\.update\s*\(/ },
  { name: 'caches.delete', re: /caches\.delete\s*\(/ },
];

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'form-savers', re: /from\s+['"][^'"]*form-savers[^'"]*['"]/ },
  { name: 'sync-manager', re: /from\s+['"][^'"]*\/sync-manager['"]/ },
  { name: 'atomic-sync-manager', re: /atomic-sync-manager/ },
  { name: 'admin-edit-snapshot', re: /from\s+['"][^'"]*admin-edit-snapshot['"]/ },
];

describe.each(FILES)('%s is structurally read-only', (file) => {
  const rawSource = readFileSync(join(process.cwd(), file), 'utf8');
  // Strip comments to avoid false positives from documentation that names the
  // forbidden tokens.
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

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
});
