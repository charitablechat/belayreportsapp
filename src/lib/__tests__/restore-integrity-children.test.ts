/**
 * Coverage for N-B (child-drift detection) and N-C (strict throw on failure)
 * in `src/lib/restore-integrity.ts`.
 *
 * Before this change the verifier only checked a handful of scalar fields on
 * the parent and silently swallowed errors from the post-write re-read. A
 * concurrent sync that stripped a child row between lock release and verify
 * would slip past, and an IDB throw during verify would be reported as
 * success. These tests lock the new behaviour.
 *
 * N-C (hardening): the verifier now calls the `readParentStrict` /
 * `readChildrenStrict` helpers (which bypass withIndexedDBErrorBoundary),
 * not the wrapped `getOfflineInspection` / `getRelatedDataOffline` helpers,
 * so real IDB throws actually propagate. These tests mock the strict helpers
 * accordingly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeParent = () => ({
  id: 'rep-1',
  organization: 'Acme',
  location: 'Site A',
  status: 'completed',
  updated_at: '2025-01-01T00:00:00.000Z',
});

interface OfflineMocks {
  readParentStrict: (reportType: string, id: string) => Promise<unknown>;
  readChildrenStrict?: (reportType: string, childStoreKey: string, parentId: string) => Promise<unknown[]>;
}

async function loadModule(offlineMock: OfflineMocks) {
  vi.resetModules();
  // Vitest's dynamic-import mock requires all accessed exports to exist on
  // the mock object, even if a particular test doesn't exercise that path.
  // Provide a default no-op readChildrenStrict so tests that never pass
  // `expectedChildren` still load cleanly.
  const filled = {
    readChildrenStrict: async () => [],
    ...offlineMock,
  };
  vi.doMock('@/lib/offline-storage', () => filled);
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
      readParentStrict: async () => makeParent(),
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
      readParentStrict: async () => makeParent(),
      readChildrenStrict: async () => [{ id: 'sys-1' }, { id: 'sys-2' }],
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
      readParentStrict: async () => makeParent(),
      readChildrenStrict: async () => [{ id: 'sys-1' }, { id: 'sys-3' }],
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
      readParentStrict: async () => makeParent(),
      readChildrenStrict: async (_rt: string, storeKey: string) => {
        if (storeKey === 'systems') return [{ id: 'sys-2' }, { id: 'sys-1' }]; // order irrelevant
        if (storeKey === 'ziplines') return [{ id: 'zl-1' }];
        return [];
      },
    });
    await mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply, { expectedChildren });
    expect(reapply).not.toHaveBeenCalled();
  });

  it('training: routes through readChildrenStrict with reportType=training', async () => {
    const reapply = vi.fn();
    const calls: Array<[string, string]> = [];
    const expectedChildren = {
      delivery_approaches: [{ id: 'da-1' }],
    };
    const mod = await loadModule({
      readParentStrict: async () => makeParent(),
      readChildrenStrict: async (rt: string, key: string) => {
        calls.push([rt, key]);
        return [{ id: 'da-1' }];
      },
    });
    await mod.verifyRestoreIntegrity('training', 'rep-1', makeParent(), reapply, { expectedChildren });
    expect(calls).toEqual([['training', 'delivery_approaches']]);
    expect(reapply).not.toHaveBeenCalled();
  });

  it('daily_assessment: routes through readChildrenStrict with reportType=daily_assessment', async () => {
    const reapply = vi.fn();
    const calls: Array<[string, string]> = [];
    const expectedChildren = {
      observations: [{ id: 'o-1' }],
    };
    const mod = await loadModule({
      readParentStrict: async () => makeParent(),
      readChildrenStrict: async (rt: string, key: string) => {
        calls.push([rt, key]);
        return [{ id: 'o-1' }];
      },
    });
    await mod.verifyRestoreIntegrity('daily_assessment', 'rep-1', makeParent(), reapply, { expectedChildren });
    expect(calls).toEqual([['daily_assessment', 'observations']]);
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
      readParentStrict: async () => {
        throw new Error('idb corrupt');
      },
    });
    await expect(
      mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply),
    ).rejects.toBeInstanceOf(mod.RestoreVerificationError);
    expect(reapply).not.toHaveBeenCalled();
  });

  it('child read throws: surfaces RestoreVerificationError', async () => {
    const reapply = vi.fn();
    const mod = await loadModule({
      readParentStrict: async () => makeParent(),
      readChildrenStrict: async () => {
        throw new Error('child store unavailable');
      },
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
      readParentStrict: async () => {
        throw root;
      },
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
      readParentStrict: async () => null,
    });
    await expect(
      mod.verifyRestoreIntegrity('inspection', 'rep-1', makeParent(), reapply),
    ).resolves.toBeUndefined();
    expect(reapply).toHaveBeenCalledTimes(1);
  });
});
