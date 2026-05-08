import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordSyncHalt,
  clearSyncHalt,
  getSyncHaltState,
  subscribeSyncHalt,
  __resetSyncHaltForTests,
} from '@/lib/sync-halt-tracker';

describe('sync-halt-tracker', () => {
  beforeEach(() => {
    __resetSyncHaltForTests();
  });

  it('starts with no halt', () => {
    expect(getSyncHaltState()).toBeNull();
  });

  it('records a halt with code, label, and detail', () => {
    recordSyncHalt('circuit_breaker_open');
    const s = getSyncHaltState();
    expect(s).not.toBeNull();
    expect(s!.code).toBe('circuit_breaker_open');
    expect(s!.label).toBe('COOLDOWN');
    expect(s!.detail).toMatch(/cooldown/i);
    expect(typeof s!.recordedAt).toBe('number');
  });

  it('records a halt with autoResumeAt when provided', () => {
    const future = Date.now() + 30_000;
    recordSyncHalt('circuit_breaker_open', { autoResumeAt: future });
    expect(getSyncHaltState()!.autoResumeAt).toBe(future);
  });

  it('clearSyncHalt resets state to null', () => {
    recordSyncHalt('no_session');
    expect(getSyncHaltState()).not.toBeNull();
    clearSyncHalt();
    expect(getSyncHaltState()).toBeNull();
  });

  it('notifies subscribers on record and clear', () => {
    const events: Array<unknown> = [];
    const unsub = subscribeSyncHalt((s) => events.push(s));
    recordSyncHalt('idb_reads_failed');
    clearSyncHalt();
    expect(events).toHaveLength(2);
    expect((events[0] as { code: string } | null)?.code).toBe('idb_reads_failed');
    expect(events[1]).toBeNull();
    unsub();
  });

  it('unsubscribe stops further notifications', () => {
    const events: Array<unknown> = [];
    const unsub = subscribeSyncHalt((s) => events.push(s));
    unsub();
    recordSyncHalt('auth_validation_timeout');
    expect(events).toHaveLength(0);
  });

  it('replaces the active halt when a different code is recorded', () => {
    recordSyncHalt('circuit_breaker_open');
    recordSyncHalt('auth_no_valid_session');
    expect(getSyncHaltState()!.code).toBe('auth_no_valid_session');
  });

  it('debounces rapid same-code records (no extra emit within 250ms)', () => {
    let emits = 0;
    subscribeSyncHalt(() => {
      emits++;
    });
    recordSyncHalt('restore_in_progress');
    recordSyncHalt('restore_in_progress');
    recordSyncHalt('restore_in_progress');
    expect(emits).toBe(1);
  });

  it('updates autoResumeAt during same-code debounce window', () => {
    const t1 = Date.now() + 10_000;
    const t2 = Date.now() + 60_000;
    recordSyncHalt('circuit_breaker_open', { autoResumeAt: t1 });
    recordSyncHalt('circuit_breaker_open', { autoResumeAt: t2 });
    expect(getSyncHaltState()!.autoResumeAt).toBe(t2);
  });

  it('clearSyncHalt is a no-op when no halt is active', () => {
    let emits = 0;
    subscribeSyncHalt(() => {
      emits++;
    });
    clearSyncHalt();
    clearSyncHalt();
    expect(emits).toBe(0);
  });

  it('isolates subscriber failures from other subscribers', () => {
    let bGotIt = false;
    subscribeSyncHalt(() => {
      throw new Error('subscriber A blew up');
    });
    subscribeSyncHalt(() => {
      bGotIt = true;
    });
    recordSyncHalt('no_session');
    expect(bGotIt).toBe(true);
  });

  it('exposes plain-English copy for every code', () => {
    const codes: Array<Parameters<typeof recordSyncHalt>[0]> = [
      'restore_in_progress',
      'circuit_breaker_open',
      'no_session',
      'auth_validation_timeout',
      'auth_no_valid_session',
      'idb_reads_failed',
    ];
    for (const code of codes) {
      __resetSyncHaltForTests();
      recordSyncHalt(code);
      const s = getSyncHaltState()!;
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.detail.length).toBeGreaterThan(10);
    }
  });
});
