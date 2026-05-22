import { describe, it, expect } from 'vitest';
import { isDuplicateInsertError } from '../photo-capture-validation';

/**
 * Regression coverage for the Training-photos duplicate-thumbnail race.
 *
 * `idx_training_photos_no_duplicates` makes the losing INSERT in a
 * foreground-vs-background race fail with Postgres SQLSTATE 23505. Both
 * insert paths (PhotoCapture.uploadPhotoInBackground and the sync-manager
 * photo loop) must swallow that specific shape and proceed to
 * `markPhotoAsUploaded`. Any other DB error must continue to surface.
 */
describe('isDuplicateInsertError', () => {
  it('returns true for Postgres SQLSTATE 23505', () => {
    expect(isDuplicateInsertError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(true);
  });

  it('returns true when message contains "duplicate" even without a code', () => {
    expect(isDuplicateInsertError({ message: 'duplicate key value' })).toBe(true);
  });

  it('returns false for a generic DB error', () => {
    expect(isDuplicateInsertError({ code: '42P01', message: 'relation does not exist' })).toBe(false);
  });

  it('returns false for null / undefined inputs', () => {
    expect(isDuplicateInsertError(null)).toBe(false);
    expect(isDuplicateInsertError(undefined)).toBe(false);
  });

  it('returns false when message is null and code is empty', () => {
    expect(isDuplicateInsertError({ message: null, code: '' })).toBe(false);
  });
});
