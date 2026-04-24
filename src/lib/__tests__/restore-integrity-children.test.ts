/**
 * Coverage for N-B (child-drift detection) and N-C (strict throw on failure)
 * in `src/lib/restore-integrity.ts`.
 *
 * Before this change the verifier only checked a handful of scalar fields on
 * the parent and silently swallowed errors from the post-write re-read. A
 * concurrent sync that stripped a child row between lock release and verify
 * would slip past, and an IDB throw during verify would be reported as
 * success. These tests lock the new behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeParent = () => ({
  id: 'rep-1',
  organization: 'Acme',
  location: 'Site A',
  status: 'completed',
  updated_at: '2025-01-01T00:00:00.000Z',
});

async function loadModule(offlineMock: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('@/lib/offline-storage', () => offlineMock);
  return await import('../restore-integrity');
}

describe('N-B — verifyRestoreIntegrity child drift detection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('no children passed: still runs parent-only check (legacy behaviour preserved)', async () => {
    const reapply = vi.fn();
    const mod = await loadModule({
      getOfflineInspection: async () => makeParent(),
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => null,
    });
    await mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply);
    expect(reapply).not.toHaveBeenCalled();
  });

  it('child drift (row missing): triggers reapply', async () => {
    const reapply = vi.fn();
    const expectedChildren = {
      systems: [{ id: 'sys-1' }, { id: 'sys-2' }, { id: 'sys-3' }],
    };
    const mod = await loadModule({
      getOfflineInspection: async () => makeParent(),
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => null,
      getRelatedDataOffline: async () => [{ id: 'sys-1' }, { id: 'sys-2' }],
      getTrainingDataOffline: async () => [],
      getAssessmentDataOffline: async () => [],
    });
    await mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply, { expectedChildren });
    expect(reapply).toHaveBeenCalledTimes(1);
  });

  it('child drift (id swapped with same count): triggers reapply', async () => {
    const reapply = vi.fn();
    const expectedChildren = {
      systems: [{ id: 'sys-1' }, { id: 'sys-2' }],
    };
    const mod = await loadModule({
      getOfflineInspection: async () => makeParent(),
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => null,
      getRelatedDataOffline: async () => [{ id: 'sys-1' }, { id: 'sys-3' }],
      getTrainingDataOffline: async () => [],
      getAssessmentDataOffline: async () => [],
    });
    await mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply, { expectedChildren });
    expect(reapply).toHaveBeenCalledTimes(1);
  });

  it('child identity matches: does NOT reapply', async () => {
    const reapply = vi.fn();
    const expectedChildren = {
      systems: [{ id: 'sys-1' }, { id: 'sys-2' }],
      ziplines: [{ id: 'zl-1' }],
    };
    const mod = await loadModule({
      getOfflineInspection: async () => makeParent(),
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => null,
      getRelatedDataOffline: async (type: string) => {
        if (type === 'systems') return [{ id: 'sys-2' }, { id: 'sys-1' }]; // order irrelevant
        if (type === 'ziplines') return [{ id: 'zl-1' }];
        return [];
      },
      getTrainingDataOffline: async () => [],
      getAssessmentDataOffline: async () => [],
    });
    await mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply, { expectedChildren });
    expect(reapply).not.toHaveBeenCalled();
  });

  it('training: routes through getTrainingDataOffline', async () => {
    const reapply = vi.fn();
    const calls: string[] = [];
    const expectedChildren = {
      delivery_approaches: [{ id: 'da-1' }],
    };
    const mod = await loadModule({
      getOfflineInspection: async () => null,
      getOfflineTraining: async () => makeParent(),
      getOfflineDailyAssessment: async () => null,
      getRelatedDataOffline: async () => { calls.push('related'); return []; },
      getTrainingDataOffline: async () => { calls.push('training'); return [{ id: 'da-1' }]; },
      getAssessmentDataOffline: async () => { calls.push('assessment'); return []; },
    });
    await mod.verifyRestoreIntegrity('training', 'rep-1', makeParent(), reapply, { expectedChildren });
    expect(calls).toEqual(['training']);
    expect(reapply).not.toHaveBeenCalled();
  });

  it('daily_assessment: routes through getAssessmentDataOffline', async () => {
    const reapply = vi.fn();
    const calls: string[] = [];
    const expectedChildren = {
      observations: [{ id: 'o-1' }],
    };
    const mod = await loadModule({
      getOfflineInspection: async () => null,
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => makeParent(),
      getRelatedDataOffline: async () => { calls.push('related'); return []; },
      getTrainingDataOffline: async () => { calls.push('training'); return []; },
      getAssessmentDataOffline: async () => { calls.push('assessment'); return [{ id: 'o-1' }]; },
    });
    await mod.verifyRestoreIntegrity('daily_assessment', 'rep-1', makeParent(), reapply, { expectedChildren });
    expect(calls).toEqual(['assessment']);
    expect(reapply).not.toHaveBeenCalled();
  });
});

describe('N-C — verifyRestoreIntegrity throws on read failure', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('parent read throws: surfaces RestoreVerificationError', async () => {
    const reapply = vi.fn();
    const mod = await loadModule({
      getOfflineInspection: async () => {
        throw new Error('idb corrupt');
      },
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => null,
    });
    await expect(
      mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply),
    ).rejects.toBeInstanceOf(mod.RestoreVerificationError);
    expect(reapply).not.toHaveBeenCalled();
  });

  it('child read throws: surfaces RestoreVerificationError', async () => {
    const reapply = vi.fn();
    const mod = await loadModule({
      getOfflineInspection: async () => makeParent(),
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => null,
      getRelatedDataOffline: async () => {
        throw new Error('child store unavailable');
      },
      getTrainingDataOffline: async () => [],
      getAssessmentDataOffline: async () => [],
    });
    await expect(
      mod.verifyRestoreIntegrity(
        'inspection',
        'rep-1',
        makeParent(),
        reapply,
        { expectedChildren: { systems: [{ id: 'sys-1' }] } },
      ),
    ).rejects.toBeInstanceOf(mod.RestoreVerificationError);
  });

  it('RestoreVerificationError preserves the underlying cause', async () => {
    const root = new Error('some specific idb error');
    const reapply = vi.fn();
    const mod = await loadModule({
      getOfflineInspection: async () => {
        throw root;
      },
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => null,
    });
    try {
      await mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(mod.RestoreVerificationError);
      expect((err as InstanceType<typeof mod.RestoreVerificationError>).cause).toBe(root);
    }
  });

  it('live record missing: does NOT throw — reapplies as before', async () => {
    const reapply = vi.fn();
    const mod = await loadModule({
      getOfflineInspection: async () => null,
      getOfflineTraining: async () => null,
      getOfflineDailyAssessment: async () => null,
    });
    await expect(
      mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply),
    ).resolves.toBeUndefined();
    expect(reapply).toHaveBeenCalledTimes(1);
  });
});
