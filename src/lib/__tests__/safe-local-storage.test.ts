import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeSetItem, safeRemoveItem } from '../safe-local-storage';

describe('safeSetItem', () => {
  let setItemSpy: any;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (setItemSpy) setItemSpy.mockRestore();
  });

  it('returns { ok: true } on a normal write', () => {
    const result = safeSetItem('test-key', 'test-value');
    expect(result.ok).toBe(true);
    expect(localStorage.getItem('test-key')).toBe('test-value');
  });

  it('returns { ok: false, code: "quota" } on QuotaExceededError', () => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err: any = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    });

    const result = safeSetItem('k', 'v', { scope: 'test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('quota');
    }
  });

  it('returns { ok: false, code: "quota" } on DOMException code 22', () => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err: any = new Error('q');
      err.code = 22;
      throw err;
    });
    const result = safeSetItem('k', 'v');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('quota');
  });

  it('returns { ok: false, code: "blocked" } on SecurityError', () => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err: any = new Error('blocked');
      err.name = 'SecurityError';
      throw err;
    });
    const result = safeSetItem('k', 'v');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('blocked');
  });

  it('returns { ok: false, code: "unknown" } on other errors', () => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('something else');
    });
    const result = safeSetItem('k', 'v');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unknown');
  });

  it('invokes onFail with the classified code', () => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err: any = new Error('q');
      err.name = 'QuotaExceededError';
      throw err;
    });
    const onFail = vi.fn();
    safeSetItem('k', 'v', { onFail });
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail.mock.calls[0][0]).toBe('quota');
  });

  it('never throws synchronously even when onFail throws', () => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('x');
    });
    expect(() =>
      safeSetItem('k', 'v', { onFail: () => { throw new Error('boom'); } })
    ).not.toThrow();
  });
});

describe('safeRemoveItem', () => {
  it('returns true on normal remove', () => {
    localStorage.setItem('k', 'v');
    expect(safeRemoveItem('k')).toBe(true);
    expect(localStorage.getItem('k')).toBeNull();
  });

  it('returns false on error and never throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => safeRemoveItem('k')).not.toThrow();
    expect(safeRemoveItem('k')).toBe(false);
    spy.mockRestore();
  });
});
