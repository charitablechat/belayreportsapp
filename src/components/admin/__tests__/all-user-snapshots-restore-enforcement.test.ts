/**
 * Slice 5C — AllUserSnapshotsPanel.handleServerRestore source-introspection
 * tests. Same pattern as the Slice 5B `data-recovery-restore-enforcement`
 * test: pins the call-site wiring so the gate, dialog, role check, and
 * service call ordering cannot be silently bypassed by a future edit.
 *
 * Behaviour assertions live in the pure-module tests:
 *   - admin-restore-envelope.test.ts
 *   - admin-restore-shape.test.ts
 *   - run-admin-restore-gate.test.ts
 *   - RestoreConfirmDialog.test.tsx
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

// Bound the All-User panel to its function body (next `function ` declaration).
const ALL_USER_PANEL = slicePanel('function AllUserSnapshotsPanel(', '\nfunction ');

// Within the panel body, isolate the handler.
function sliceHandler(panel: string, signature: string): string {
  const start = panel.indexOf(signature);
  if (start === -1) throw new Error(`handler not found: ${signature}`);
  // End at the next `const handle` or `const formatDate` declaration (handlers + helpers are siblings).
  const candidates = ['\n  const handleExport', '\n  const formatDate', '\n  return ('];
  let stop = panel.length;
  for (const cand of candidates) {
    const idx = panel.indexOf(cand, start + 1);
    if (idx !== -1 && idx < stop) stop = idx;
  }
  return panel.slice(start, stop);
}

const HANDLER = sliceHandler(ALL_USER_PANEL, 'const handleServerRestore = async');

describe('AllUserSnapshotsPanel — Slice 5C enforcement wiring', () => {
  describe('imports + hooks', () => {
    it('imports runAdminRestoreGate + adminBlockReasonToast + compareAdminRestoreGateRestrictiveness + fingerprintAdminSnapshot', () => {
      expect(SOURCE).toMatch(/from\s+["']@\/lib\/recovery\/run-admin-restore-gate["']/);
      expect(SOURCE).toContain('runAdminRestoreGate');
      expect(SOURCE).toContain('adminBlockReasonToast');
      expect(SOURCE).toContain('compareAdminRestoreGateRestrictiveness');
      expect(SOURCE).toContain('fingerprintAdminSnapshot');
    });
    it('panel uses non-redirecting role hook (NOT useRequireAdmin)', () => {
      expect(ALL_USER_PANEL).toContain('useRoleStatus()');
      expect(ALL_USER_PANEL).not.toContain('useRequireAdmin');
    });
    it('panel renders the RestoreConfirmDialog', () => {
      expect(ALL_USER_PANEL).toContain('<RestoreConfirmDialog');
    });
  });

  describe('handleServerRestore — fail-closed sequencing', () => {
    it('runs role precheck BEFORE fetching the snapshot', () => {
      const roleIdx = HANDLER.indexOf('roleLoading || isAdmin');
      const fetchIdx = HANDLER.indexOf('fetchCloudSnapshot');
      expect(roleIdx).toBeGreaterThan(-1);
      expect(fetchIdx).toBeGreaterThan(-1);
      expect(roleIdx).toBeLessThan(fetchIdx);
    });

    it('runs runAdminRestoreGate BEFORE opening the confirmation dialog', () => {
      const gateIdx = HANDLER.indexOf('runAdminRestoreGate(');
      const confirmIdx = HANDLER.indexOf('awaitConfirm(');
      expect(gateIdx).toBeGreaterThan(-1);
      expect(confirmIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeLessThan(confirmIdx);
    });

    it('routes block results through adminBlockReasonToast (generic copy, never includes sensitive metadata)', () => {
      expect(HANDLER).toMatch(/adminBlockReasonToast\(/);
    });

    it('awaits confirmation BEFORE acquiring withRestoreLock', () => {
      const confirmIdx = HANDLER.indexOf('awaitConfirm(');
      const lockIdx = HANDLER.indexOf('withRestoreLock(');
      expect(confirmIdx).toBeGreaterThan(-1);
      expect(lockIdx).toBeGreaterThan(-1);
      expect(confirmIdx).toBeLessThan(lockIdx);
    });

    it('aborts with zero mutation when confirmation returns falsy', () => {
      expect(HANDLER).toMatch(/if\s*\(\s*!confirmed\s*\)\s*return;/);
    });

    it('re-fetches the snapshot row INSIDE withRestoreLock (TOCTOU defense)', () => {
      const lockStart = HANDLER.indexOf('withRestoreLock(');
      const inLock = HANDLER.slice(lockStart);
      // Two snapshot fetches total: one pre-lock, one in-lock.
      const fetches = (HANDLER.match(/fetchCloudSnapshot\(/g) || []).length;
      expect(fetches).toBeGreaterThanOrEqual(2);
      expect(inLock).toContain('fetchCloudSnapshot(');
    });

    it('compares fingerprintAdminSnapshot in-lock against the pre-confirm fingerprint', () => {
      const lockStart = HANDLER.indexOf('withRestoreLock(');
      const inLock = HANDLER.slice(lockStart);
      expect(inLock).toContain('fingerprintAdminSnapshot(');
      // The pre-confirm fingerprint variable must be referenced in-lock.
      expect(inLock).toMatch(/!==\s*preFingerprint/);
    });

    it('re-runs runAdminRestoreGate INSIDE withRestoreLock (escalation re-check)', () => {
      const lockStart = HANDLER.indexOf('withRestoreLock(');
      const inLock = HANDLER.slice(lockStart);
      const occurrences = (HANDLER.match(/runAdminRestoreGate\(/g) || []).length;
      expect(occurrences).toBeGreaterThanOrEqual(2);
      expect(inLock).toContain('runAdminRestoreGate(');
      expect(inLock).toContain('compareAdminRestoreGateRestrictiveness(');
    });

    it('calls restoreSnapshotToServer ONLY inside withRestoreLock', () => {
      const lockStart = HANDLER.indexOf('withRestoreLock(');
      const preLock = HANDLER.slice(0, lockStart);
      expect(preLock).not.toContain('restoreSnapshotToServer(');
      const inLock = HANDLER.slice(lockStart);
      expect(inLock).toContain('restoreSnapshotToServer(');
    });

    it('shows the success toast ONLY on a truthy service return value', () => {
      // Required pattern: `if (ok) { toast.success(...) } else { toast.error(...) }`
      expect(HANDLER).toMatch(/if\s*\(\s*ok\s*\)\s*\{[\s\S]*?toast\.success/);
      expect(HANDLER).toMatch(/}\s*else\s*\{[\s\S]*?toast\.error/);
    });

    it('logs only through the Slice 5A sanitizers (never the raw error / snapshot body)', () => {
      expect(HANDLER).not.toMatch(/console\.error\([^)]*,\s*error\s*\)/);
      expect(HANDLER).toContain('sanitizeRecoveryErrorForLog(error)');
      // No `snapshot_data` / `parent` / `children` references in the catch path.
      const catches = HANDLER.split('catch (error)').slice(1).join('\n');
      expect(catches).not.toContain('snapshot_data');
      expect(catches).not.toContain('children');
      expect(catches).not.toContain('full.snapshot_data');
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
