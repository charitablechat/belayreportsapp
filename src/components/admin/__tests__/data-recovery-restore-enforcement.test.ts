/**
 * Slice 5B — DataRecoveryTool restore-enforcement wiring tests.
 *
 * Source-introspection tests (same pattern as the Slice 5A characterization
 * file) that prove the structural enforcement contracts on the two
 * Local/Cloud restore handlers in DataRecoveryTool.tsx. A render-based
 * behavior test would require mocking 10+ modules (offline-storage,
 * cloud-backup, local-backup-ledger, restore-integrity, restore-lock,
 * supabase client, sonner, role hook, IDB) and risk the same false sense
 * of safety the Slice 5A revision was hardened against.
 *
 * Behavior assertions live in the focused pure-module tests:
 *   - restore-envelope.test.ts
 *   - restore-shape.test.ts
 *   - restore-stale.test.ts
 *   - restore-completion-lock.test.ts
 *   - restore-gate.test.ts
 *   - run-restore-gate.test.ts
 *   - RestoreConfirmDialog.test.tsx
 *
 * This file pins the call-site wiring so the validators cannot be silently
 * bypassed by a future edit.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(__dirname, '..', 'DataRecoveryTool.tsx'),
  'utf8',
);

// Each Local/Cloud handler body. We split the file at the handler signatures
// and inspect each block independently.
function sliceHandler(after: string, end = '\n  };'): string {
  const start = SOURCE.indexOf(after);
  if (start === -1) throw new Error(`handler marker not found: ${after}`);
  const stop = SOURCE.indexOf(end, start);
  return SOURCE.slice(start, stop === -1 ? start + 5000 : stop + end.length);
}

const LOCAL_HANDLER = sliceHandler(
  '  const handleRestore = async (reportType: ReportType, reportId: string) => {',
);
const CLOUD_HANDLER = sliceHandler(
  '  const handleRestore = async (snapshotId: string) => {',
);

describe('DataRecoveryTool — Slice 5B enforcement wiring', () => {
  describe('imports the Slice 5B helpers', () => {
    it('imports runRestoreGate + blockReasonToast from the recovery module', () => {
      expect(SOURCE).toMatch(/from\s+["']@\/lib\/recovery\/run-restore-gate["']/);
      expect(SOURCE).toContain('runRestoreGate');
      expect(SOURCE).toContain('blockReasonToast');
    });
    it('imports compareRestoreGateRestrictiveness from the gate module', () => {
      expect(SOURCE).toMatch(/from\s+["']@\/lib\/recovery\/restore-gate["']/);
      expect(SOURCE).toContain('compareRestoreGateRestrictiveness');
    });
    it('imports the RestoreConfirmDialog component', () => {
      expect(SOURCE).toContain('RestoreConfirmDialog');
    });
    it('imports useRoleStatus (non-redirecting role hook)', () => {
      expect(SOURCE).toMatch(/from\s+["']@\/hooks\/useRoleStatus["']/);
      expect(SOURCE).toContain('useRoleStatus');
    });
    it('does NOT import useRequireAdmin (which would redirect non-admins)', () => {
      expect(SOURCE).not.toContain('useRequireAdmin');
    });
  });

  for (const [name, body] of [
    ['Local restore handler', LOCAL_HANDLER] as const,
    ['Cloud restore handler', CLOUD_HANDLER] as const,
  ]) {
    describe(name, () => {
      it('runs the pre-write gate', () => {
        expect(body).toContain('runRestoreGate(');
      });

      it('routes block results through blockReasonToast (generic user-facing copy)', () => {
        expect(body).toMatch(/blockReasonToast\(/);
      });

      it('awaits explicit user confirmation BEFORE acquiring withRestoreLock', () => {
        const confirmIdx = body.indexOf('awaitRestoreConfirm(');
        const lockIdx = body.indexOf('withRestoreLock(');
        expect(confirmIdx).toBeGreaterThan(-1);
        expect(lockIdx).toBeGreaterThan(-1);
        expect(confirmIdx).toBeLessThan(lockIdx);
      });

      it('aborts with zero mutation when confirmation returns falsy', () => {
        // Pattern: `if (!confirmed) return;`
        expect(body).toMatch(/if\s*\(\s*!confirmed\s*\)\s*return;/);
      });

      it('re-runs runRestoreGate INSIDE withRestoreLock (race re-check)', () => {
        const lockStart = body.indexOf('withRestoreLock(');
        const afterLock = body.slice(lockStart);
        // Two calls to runRestoreGate in the handler — one pre-lock, one in-lock.
        const occurrences = (body.match(/runRestoreGate\(/g) || []).length;
        expect(occurrences).toBeGreaterThanOrEqual(2);
        expect(afterLock).toContain('runRestoreGate(');
      });

      it('aborts via compareRestoreGateRestrictiveness when in-lock gate escalates', () => {
        expect(body).toContain('compareRestoreGateRestrictiveness(');
        // Escalation abort surfaces a user-friendly "state changed" toast.
        expect(body).toMatch(/Local state changed during confirmation/);
      });

      it('passes isAdmin (from useRoleStatus) into the gate', () => {
        expect(body).toMatch(/isAdmin\s*,?\s*\n?\s*\}\s*\)\s*;/);
      });

      it('keeps verifyRestoreIntegrity inside the lock, after the save calls', () => {
        const lockStart = body.indexOf('withRestoreLock(');
        const afterLock = body.slice(lockStart);
        expect(afterLock).toContain('verifyRestoreIntegrity(');
      });

      it('only logs through the Slice 5A sanitizers (no raw error / no snapshot body in catch)', () => {
        // No bare `console.error(... , error)` shape (raw error object).
        expect(body).not.toMatch(/console\.error\([^)]*,\s*error\s*\)/);
        // Sanitizers are present.
        expect(body).toContain('sanitizeRecoveryErrorForLog(error)');
        expect(body).toContain('sanitizeRecoveryLogMetadata(');
      });
    });
  }

  describe('regular-user surface stays accessible', () => {
    it('UserDataRecoverySheet still mounts LocalSnapshotsPanel + CloudSnapshotsPanel from this file', () => {
      const sheet = readFileSync(
        resolve(__dirname, '..', '..', 'UserDataRecoverySheet.tsx'),
        'utf8',
      );
      expect(sheet).toContain('LocalSnapshotsPanel');
      expect(sheet).toContain('CloudSnapshotsPanel');
      // No admin gate / redirect / role-guard added.
      expect(sheet).not.toContain('useRequireAdmin');
      expect(sheet).not.toMatch(/navigate\(/);
    });
  });

  describe('cross-platform shared-path invariant', () => {
    it('both handlers route through the same src/lib/recovery/* validators (no per-platform branch)', () => {
      expect(LOCAL_HANDLER).toContain('runRestoreGate(');
      expect(CLOUD_HANDLER).toContain('runRestoreGate(');
      // Neither handler may branch on a platform / user-agent string.
      for (const body of [LOCAL_HANDLER, CLOUD_HANDLER]) {
        expect(body).not.toMatch(/navigator\.userAgent/);
        expect(body).not.toMatch(/isIPad|isIOS|isAndroid/);
      }
    });
  });
});
