/**
 * Slice 5C — AdminEditHistoryPanel.handleRestore source-introspection
 * tests. Mirrors `all-user-snapshots-restore-enforcement.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(__dirname, '..', 'DataRecoveryTool.tsx'),
  'utf8',
);

function slicePanel(marker: string, end: string): string {
  const start = SOURCE.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  const stop = SOURCE.indexOf(end, start);
  return SOURCE.slice(start, stop === -1 ? start + 12000 : stop);
}

const EDIT_PANEL = slicePanel('function AdminEditHistoryPanel(', '\nfunction ');

function sliceHandler(panel: string, signature: string): string {
  const start = panel.indexOf(signature);
  if (start === -1) throw new Error(`handler not found: ${signature}`);
  const candidates = ['\n  const handleExport', '\n  const formatDate', '\n  return ('];
  let stop = panel.length;
  for (const cand of candidates) {
    const idx = panel.indexOf(cand, start + 1);
    if (idx !== -1 && idx < stop) stop = idx;
  }
  return panel.slice(start, stop);
}

const HANDLER = sliceHandler(EDIT_PANEL, 'const handleRestore = async');

describe('AdminEditHistoryPanel — Slice 5C enforcement wiring', () => {
  describe('imports + hooks', () => {
    it('imports fetchAdminEditSnapshotById (narrow raw-row helper)', () => {
      expect(SOURCE).toContain('fetchAdminEditSnapshotById');
      expect(SOURCE).toMatch(/from\s+["']@\/lib\/admin-edit-snapshot["']/);
    });
    it('panel uses non-redirecting role hook', () => {
      expect(EDIT_PANEL).toContain('useRoleStatus()');
      expect(EDIT_PANEL).not.toContain('useRequireAdmin');
    });
    it('panel renders the RestoreConfirmDialog', () => {
      expect(EDIT_PANEL).toContain('<RestoreConfirmDialog');
    });
  });

  describe('handleRestore — fail-closed sequencing', () => {
    it('runs role precheck BEFORE fetching the snapshot row', () => {
      const roleIdx = HANDLER.indexOf('roleLoading || isAdmin');
      const fetchIdx = HANDLER.indexOf('fetchAdminEditSnapshotById');
      expect(roleIdx).toBeGreaterThan(-1);
      expect(fetchIdx).toBeGreaterThan(-1);
      expect(roleIdx).toBeLessThan(fetchIdx);
    });

    it('runs runAdminRestoreGate BEFORE opening the confirmation dialog', () => {
      const gateIdx = HANDLER.indexOf('runAdminRestoreGate(');
      const confirmIdx = HANDLER.indexOf('awaitConfirm(');
      expect(gateIdx).toBeLessThan(confirmIdx);
    });

    it('routes block results through adminBlockReasonToast', () => {
      expect(HANDLER).toMatch(/adminBlockReasonToast\(/);
    });

    it('awaits confirmation BEFORE acquiring withRestoreLock', () => {
      const confirmIdx = HANDLER.indexOf('awaitConfirm(');
      const lockIdx = HANDLER.indexOf('withRestoreLock(');
      expect(confirmIdx).toBeLessThan(lockIdx);
    });

    it('aborts with zero mutation when confirmation returns falsy', () => {
      expect(HANDLER).toMatch(/if\s*\(\s*!confirmed\s*\)\s*return;/);
    });

    it('re-fetches the snapshot row INSIDE withRestoreLock (TOCTOU defense)', () => {
      const lockStart = HANDLER.indexOf('withRestoreLock(');
      const inLock = HANDLER.slice(lockStart);
      const fetches = (HANDLER.match(/fetchAdminEditSnapshotById\(/g) || []).length;
      expect(fetches).toBeGreaterThanOrEqual(2);
      expect(inLock).toContain('fetchAdminEditSnapshotById(');
      expect(inLock).toContain('fingerprintAdminSnapshot(');
      expect(inLock).toMatch(/!==\s*preFingerprint/);
    });

    it('re-runs runAdminRestoreGate INSIDE withRestoreLock (escalation re-check)', () => {
      const lockStart = HANDLER.indexOf('withRestoreLock(');
      const inLock = HANDLER.slice(lockStart);
      const occurrences = (HANDLER.match(/runAdminRestoreGate\(/g) || []).length;
      expect(occurrences).toBeGreaterThanOrEqual(2);
      expect(inLock).toContain('compareAdminRestoreGateRestrictiveness(');
    });

    it('calls restoreAdminEditSnapshot ONLY inside withRestoreLock', () => {
      const lockStart = HANDLER.indexOf('withRestoreLock(');
      const preLock = HANDLER.slice(0, lockStart);
      expect(preLock).not.toContain('restoreAdminEditSnapshot(');
      const inLock = HANDLER.slice(lockStart);
      expect(inLock).toContain('restoreAdminEditSnapshot(');
    });

    it('shows the success toast ONLY on a truthy service return value', () => {
      expect(HANDLER).toMatch(/if\s*\(\s*ok\s*\)\s*\{[\s\S]*?toast\.success/);
      expect(HANDLER).toMatch(/}\s*else\s*\{[\s\S]*?toast\.error/);
    });

    it('logs only through the Slice 5A sanitizers (never the raw error / snapshot body)', () => {
      expect(HANDLER).not.toMatch(/console\.error\([^)]*,\s*error\s*\)/);
      expect(HANDLER).toContain('sanitizeRecoveryErrorForLog(error)');
      const catches = HANDLER.split('catch (error)').slice(1).join('\n');
      expect(catches).not.toContain('snapshot_data');
      expect(catches).not.toContain('children');
    });
  });

  describe('cross-platform shared-path invariant', () => {
    it('handler routes through src/lib/recovery/* validators (no per-platform branch)', () => {
      expect(HANDLER).toContain('runAdminRestoreGate(');
      expect(HANDLER).not.toMatch(/navigator\.userAgent/);
      expect(HANDLER).not.toMatch(/isIPad|isIOS|isAndroid/);
    });
  });

  describe('full-DB backup restore is NOT included in Slice 5C', () => {
    it('handler does NOT call restore-full-backup or restoreFromServer', () => {
      expect(HANDLER).not.toContain('restore-full-backup');
      expect(HANDLER).not.toContain('restoreFromServer(');
      expect(HANDLER).not.toContain('restoreFromFile(');
    });
  });
});
