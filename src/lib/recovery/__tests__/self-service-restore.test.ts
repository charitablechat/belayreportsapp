import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory store for the table mocks.
const mockState = {
  userId: 'owner-uid' as string | null,
  training: null as null | { id: string; inspector_id: string; updated_at: string | null },
  summary: null as null | { observations: string | null; recommendations: string | null },
  rpcReturn: { data: null as unknown, error: null as { message?: string } | null },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  online: true,
};

vi.mock('@/lib/cached-auth', () => ({
  getUserWithCache: async () => (mockState.userId ? { id: mockState.userId } : null),
}));

vi.mock('@/integrations/supabase/client', () => {
  const trainingsBuilder = () => {
    const q: Record<string, unknown> = {};
    const b = {
      select: () => b,
      eq: (_col: string, _val: string) => b,
      maybeSingle: async () => {
        return { data: mockState.training, error: null };
      },
      _q: q,
    };
    return b;
  };
  const summaryBuilder = () => {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: mockState.summary, error: null }),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'trainings') return trainingsBuilder();
        if (table === 'training_summary') return summaryBuilder();
        throw new Error(`unexpected table ${table}`);
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        mockState.rpcCalls.push({ name, args });
        return mockState.rpcReturn;
      },
    },
  };
});

// navigator.onLine
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, userAgent: 'vitest' },
  writable: true,
  configurable: true,
});

import {
  checkEligibility,
  performRestore,
  plainEnglishFailure,
} from '../self-service-restore';

const TRAINING_ID = '00000000-0000-0000-0000-000000000aaa';

beforeEach(() => {
  mockState.userId = 'owner-uid';
  mockState.training = {
    id: TRAINING_ID,
    inspector_id: 'owner-uid',
    updated_at: '2026-06-01T00:00:00Z',
  };
  mockState.summary = { observations: null, recommendations: null };
  mockState.rpcCalls = [];
  mockState.rpcReturn = { data: null, error: null };
  (globalThis as { navigator: { onLine: boolean; userAgent: string } }).navigator = {
    onLine: true,
    userAgent: 'vitest',
  };
});

describe('checkEligibility', () => {
  it('owner with blank field → eligible', async () => {
    const r = await checkEligibility({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: '<p>hello</p>',
    });
    expect(r.eligible).toBe(true);
  });

  it('non-owner → not_owner', async () => {
    mockState.training!.inspector_id = 'someone-else';
    const r = await checkEligibility({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
    });
    expect(r).toEqual({ eligible: false, reason: 'not_owner' });
  });

  it('populated field → field_populated', async () => {
    mockState.summary = { observations: 'already here', recommendations: null };
    const r = await checkEligibility({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
    });
    expect(r).toEqual({ eligible: false, reason: 'field_populated' });
  });

  it('offline → offline', async () => {
    (globalThis as { navigator: { onLine: boolean } }).navigator.onLine = false;
    const r = await checkEligibility({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
    });
    expect(r).toEqual({ eligible: false, reason: 'offline' });
  });

  it('invalid field → invalid_field', async () => {
    const r = await checkEligibility({
      trainingId: TRAINING_ID,
      // @ts-expect-error testing invalid input
      field: 'critical_actions',
      recoveredText: 'hi',
    });
    expect(r).toEqual({ eligible: false, reason: 'invalid_field' });
  });

  it('empty recovered text → empty_recovered_text', async () => {
    const r = await checkEligibility({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: '<p>   </p>',
    });
    expect(r).toEqual({ eligible: false, reason: 'empty_recovered_text' });
  });

  it('signed-out → not_signed_in', async () => {
    mockState.userId = null;
    const r = await checkEligibility({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
    });
    expect(r).toEqual({ eligible: false, reason: 'not_signed_in' });
  });
});

describe('performRestore', () => {
  it('owner success → ok=true and exactly one RPC', async () => {
    mockState.rpcReturn = {
      data: {
        ok: true,
        training_id: TRAINING_ID,
        field: 'observations',
        summary_id: 'sid',
        snapshot_id: 'snap',
        server_updated_at: '2026-06-01T00:00:01Z',
        restored_length: 5,
      },
      error: null,
    };
    const r = await performRestore({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hello',
      scanSeenUpdatedAt: '2026-06-01T00:00:00Z',
    });
    expect(r.ok).toBe(true);
    expect(mockState.rpcCalls).toHaveLength(1);
    expect(mockState.rpcCalls[0].name).toBe(
      'self_service_fill_missing_training_field',
    );
    expect(mockState.rpcCalls[0].args.p_field).toBe('observations');
    expect(mockState.rpcCalls[0].args.p_recovered_text).toBe('hello');
  });

  it('field_populated returned by DB → no overwrite path', async () => {
    mockState.rpcReturn = {
      data: { ok: false, reason: 'field_populated' },
      error: null,
    };
    const r = await performRestore({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
      scanSeenUpdatedAt: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'field_populated' });
  });

  it('needs_rescan returned by DB → propagated typed reason', async () => {
    mockState.rpcReturn = {
      data: { ok: false, reason: 'needs_rescan', server_updated_at: 'x' },
      error: null,
    };
    const r = await performRestore({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
      scanSeenUpdatedAt: '2026-01-01T00:00:00Z',
    });
    expect(r).toMatchObject({ ok: false, reason: 'needs_rescan' });
  });

  it('offline → does not call RPC', async () => {
    (globalThis as { navigator: { onLine: boolean } }).navigator.onLine = false;
    const r = await performRestore({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
      scanSeenUpdatedAt: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'offline' });
    expect(mockState.rpcCalls).toHaveLength(0);
  });

  it('empty recovered text → does not call RPC', async () => {
    const r = await performRestore({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: '   ',
      scanSeenUpdatedAt: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'empty_recovered_text' });
    expect(mockState.rpcCalls).toHaveLength(0);
  });

  it('transport error → rpc_failed (detail hidden from user via plainEnglishFailure)', async () => {
    mockState.rpcReturn = { data: null, error: { message: 'network down' } };
    const r = await performRestore({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
      scanSeenUpdatedAt: null,
    });
    expect(r.ok).toBe(false);
    const failure = r as Extract<typeof r, { ok: false }>;
    expect(failure.reason).toBe('rpc_failed');
    expect(failure.detail).toBe('network down');
    // Plain-English message must NOT include the raw detail.
    const msg = plainEnglishFailure(failure.reason);
    expect(msg).not.toContain('network down');
  });

  it('silent-null (data=null, error=null) → internal_error', async () => {
    mockState.rpcReturn = { data: null, error: null };
    const r = await performRestore({
      trainingId: TRAINING_ID,
      field: 'observations',
      recoveredText: 'hi',
      scanSeenUpdatedAt: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'internal_error' });
  });

  it('plainEnglishFailure never leaks technical reason names', () => {
    const reasons = [
      'needs_rescan',
      'field_populated',
      'offline',
      'not_signed_in',
      'not_owner',
      'invalid_field',
      'empty_recovered_text',
      'training_not_found',
      'conflict',
      'internal_error',
      'rpc_failed',
    ] as const;
    for (const r of reasons) {
      const msg = plainEnglishFailure(r);
      expect(msg).not.toContain('rpc');
      expect(msg).not.toContain('SQL');
      expect(msg).not.toMatch(/undefined|null|stack/i);
      expect(msg.length).toBeGreaterThan(10);
    }
  });
});
