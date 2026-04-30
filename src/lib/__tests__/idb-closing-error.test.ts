import { describe, it, expect } from 'vitest';
import { isIdbClosingError, isDocumentHidden } from '../idb-closing-error';

/**
 * Audit M4 — coverage for the shared IDB-closing-error helpers.
 *
 * The helpers are tiny but the contract is load-bearing for every resilience
 * boundary in the app: a false positive trips the circuit breaker on a
 * benign bfcache resume; a false negative re-introduces the original
 * "InvalidStateError on tab switch" Sentry storm we extracted them to
 * suppress.
 */

describe('audit M4 — isIdbClosingError', () => {
  it('matches the canonical InvalidStateError shape from iOS Safari', () => {
    const err = new Error("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing");
    (err as Error & { name: string }).name = 'InvalidStateError';
    expect(isIdbClosingError(err)).toBe(true);
  });

  it('matches by name even when message has been stripped', () => {
    const err = new Error('');
    (err as Error & { name: string }).name = 'InvalidStateError';
    expect(isIdbClosingError(err)).toBe(true);
  });

  it('matches by message when name has been clobbered to plain Error', () => {
    const err = new Error('The database connection is closing');
    expect(isIdbClosingError(err)).toBe(true);
  });

  it('matches duck-typed cross-realm errors (no Error prototype)', () => {
    const duck = { name: 'InvalidStateError', message: 'whatever' };
    expect(isIdbClosingError(duck)).toBe(true);
  });

  it('matches when the message contains the literal "InvalidStateError" substring', () => {
    expect(isIdbClosingError({ message: 'oops InvalidStateError happened' })).toBe(true);
  });

  it('rejects unrelated errors', () => {
    const quota = new Error('QuotaExceededError');
    (quota as Error & { name: string }).name = 'QuotaExceededError';
    expect(isIdbClosingError(quota)).toBe(false);
    expect(isIdbClosingError(new Error('TypeError: Failed to fetch'))).toBe(false);
  });

  it('rejects null / undefined / primitives without throwing', () => {
    expect(isIdbClosingError(null)).toBe(false);
    expect(isIdbClosingError(undefined)).toBe(false);
    expect(isIdbClosingError('InvalidStateError')).toBe(false);
    expect(isIdbClosingError(42)).toBe(false);
    expect(isIdbClosingError(false)).toBe(false);
  });

  it('rejects an empty object (no name, no message)', () => {
    expect(isIdbClosingError({})).toBe(false);
  });

  it('rejects an object with a non-string message', () => {
    expect(isIdbClosingError({ message: 123 })).toBe(false);
  });
});

describe('audit M4 — isDocumentHidden', () => {
  it('returns false when document.visibilityState is "visible"', () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    expect(isDocumentHidden()).toBe(false);
  });

  it('returns true when document.visibilityState is "hidden"', () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    expect(isDocumentHidden()).toBe(true);
  });

  it('does not match other lifecycle states (e.g. "prerender")', () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'prerender',
      writable: true,
      configurable: true,
    });
    expect(isDocumentHidden()).toBe(false);
  });
});
