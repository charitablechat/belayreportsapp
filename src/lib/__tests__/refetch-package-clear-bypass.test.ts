/**
 * Refetch cache-refresh bypass coverage.
 *
 * Each of `refetchInspectionPackage`, `refetchTrainingPackage`, and
 * `refetchAssessmentPackage` in `src/lib/atomic-sync-manager.ts` has
 * just fetched authoritative server child rows for a known-permanent
 * report id and is about to replace the local cached child rows.
 * That is the documented exception to the temp-ID clear guard, so
 * every guarded clear call inside those refetch replacement blocks
 * MUST pass `{ bypassTempGuard: true }`. Otherwise the guard fires
 * `[SAFETY] Blocked clear ...` on every Realtime / post-sync refetch
 * and the child cache never refreshes.
 *
 * Mirrors the static-source assertion pattern in
 * `training-summary-boundary-merge.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '..', 'atomic-sync-manager.ts'),
  'utf8',
);

function extractFunctionBody(fnName: string): string {
  const re = new RegExp(
    String.raw`export async function ${fnName}\b[\s\S]*?\n\}\n`,
    'm',
  );
  const m = src.match(re);
  if (!m) throw new Error(`Could not locate ${fnName} body`);
  return m[0];
}

describe('refetch package: temp-guard bypass on permanent IDs', () => {
  it('refetchInspectionPackage passes bypassTempGuard to every clearRelatedDataOffline call', () => {
    const body = extractFunctionBody('refetchInspectionPackage');
    const calls = body.match(/clearRelatedDataOffline\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `missing bypassTempGuard in: ${call}`).toMatch(
        /bypassTempGuard:\s*true/,
      );
    }
  });

  it('refetchTrainingPackage passes bypassTempGuard to every clearTrainingDataOffline call', () => {
    const body = extractFunctionBody('refetchTrainingPackage');
    const calls = body.match(/clearTrainingDataOffline\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `missing bypassTempGuard in: ${call}`).toMatch(
        /bypassTempGuard:\s*true/,
      );
    }
  });

  it('refetchAssessmentPackage passes bypassTempGuard to every clearAssessmentDataOffline call', () => {
    const body = extractFunctionBody('refetchAssessmentPackage');
    const calls = body.match(/clearAssessmentDataOffline\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `missing bypassTempGuard in: ${call}`).toMatch(
        /bypassTempGuard:\s*true/,
      );
    }
  });

  it('default temp-ID guard still blocks permanent-ID clears elsewhere (regression guard)', () => {
    // The three guard functions in offline-storage.ts must still
    // refuse permanent UUIDs unless the explicit option is passed.
    const offlineSrc = readFileSync(
      resolve(__dirname, '..', 'offline-storage.ts'),
      'utf8',
    );
    for (const fn of [
      'clearRelatedDataOffline',
      'clearTrainingDataOffline',
      'clearAssessmentDataOffline',
    ]) {
      const re = new RegExp(
        String.raw`export async function ${fn}\b[\s\S]*?\n\}\n`,
        'm',
      );
      const m = offlineSrc.match(re);
      expect(m, `${fn} body not found`).toBeTruthy();
      const body = m![0];
      expect(body, `${fn} must reject non-temp IDs unless bypassed`).toMatch(
        /!\s*[A-Za-z_]+Id\.startsWith\('temp-'\)\s*&&\s*!options\?\.bypassTempGuard/,
      );
      expect(body, `${fn} must log [SAFETY] Blocked clear`).toMatch(
        /\[SAFETY\] Blocked clear/,
      );
    }
  });
});
