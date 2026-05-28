/**
 * Contract tests for `isIdbDeletedError`.
 *
 * Pins the narrow Safari/iOS storage-pressure pattern so that future
 * widening of the matcher (or accidental regex relaxation) fails this
 * test instead of silently swallowing unrelated `UnknownError` shapes
 * or other "deleted" messages.
 */
import { describe, it, expect } from 'vitest';
import { isIdbDeletedError } from '../idb-closing-error';
import { classifyRecoverableSentryEvent } from '../sentry';

describe('isIdbDeletedError', () => {
  it('matches the canonical Safari/iOS shape', () => {
    const err = new Error('Database deleted by request of the user');
    (err as Error & { name: string }).name = 'UnknownError';
    expect(isIdbDeletedError(err)).toBe(true);
  });

  it('matches when name has been stripped (cross-realm rethrow)', () => {
    expect(
      isIdbDeletedError({ message: 'Database deleted by request of the user' }),
    ).toBe(true);
  });

  it('matches duck-typed errors without an Error prototype', () => {
    expect(
      isIdbDeletedError({
        name: 'UnknownError',
        message: 'Database deleted by request of the user',
      }),
    ).toBe(true);
  });

  it('does NOT match unrelated UnknownError shapes', () => {
    const err = new Error('Something else went wrong');
    (err as Error & { name: string }).name = 'UnknownError';
    expect(isIdbDeletedError(err)).toBe(false);
  });

  it('does NOT match unrelated "deleted" messages', () => {
    expect(isIdbDeletedError({ message: 'Record deleted' })).toBe(false);
    expect(isIdbDeletedError({ message: 'Database connection is closing' })).toBe(false);
  });

  it('rejects null / primitives without throwing', () => {
    expect(isIdbDeletedError(null)).toBe(false);
    expect(isIdbDeletedError(undefined)).toBe(false);
    expect(isIdbDeletedError('Database deleted by request of the user')).toBe(false);
    expect(isIdbDeletedError(42)).toBe(false);
  });
});

describe('Sentry classifier — IDB eviction downgrade', () => {
  it('downgrades UnknownError "Database deleted by request of the user" to warning with stable fingerprint', () => {
    const result = classifyRecoverableSentryEvent(
      'UnknownError',
      'Database deleted by request of the user',
    );
    expect(result).not.toBeNull();
    expect(result?.level).toBe('warning');
    expect(result?.fingerprint).toEqual([
      'UnknownError',
      'idb-deleted',
      '{{default}}',
    ]);
  });

  it('does not downgrade other UnknownError messages', () => {
    expect(
      classifyRecoverableSentryEvent('UnknownError', 'Some other failure'),
    ).toBeNull();
  });
});
