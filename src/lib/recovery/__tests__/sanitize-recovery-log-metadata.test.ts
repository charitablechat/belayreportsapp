import { describe, it, expect } from 'vitest';
import {
  sanitizeRecoveryLogMetadata,
  sanitizeRecoveryErrorForLog,
} from '@/lib/recovery/restore-decision';

describe('sanitizeRecoveryLogMetadata', () => {
  it('returns empty object for null / undefined / non-object', () => {
    expect(sanitizeRecoveryLogMetadata(null)).toEqual({});
    expect(sanitizeRecoveryLogMetadata(undefined)).toEqual({});
    // @ts-expect-error — runtime guard test
    expect(sanitizeRecoveryLogMetadata('nope')).toEqual({});
  });

  it('returns only whitelisted keys', () => {
    const out = sanitizeRecoveryLogMetadata({
      reportType: 'inspection',
      reportId: 'r1',
      snapshot: {
        parent: { id: 'p1', updated_at: '2026-01-01T00:00:00Z' },
        children: { systems: [{}, {}], comments: [] },
      },
    });
    expect(Object.keys(out).sort()).toEqual([
      'childCounts',
      'parentId',
      'parentUpdatedAt',
      'reportId',
      'reportType',
    ]);
  });

  it('drops sensitive fields from parent (organization, location, site, client_name, notes)', () => {
    const out = sanitizeRecoveryLogMetadata({
      reportType: 'inspection',
      reportId: 'r1',
      snapshot: {
        parent: {
          id: 'p1',
          updated_at: '2026-01-01T00:00:00Z',
          organization: 'ACME Corp',
          location: '123 Main St',
          site: 'Building A',
          client_name: 'Jane Doe',
          notes: 'Sensitive notes content',
        },
      },
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('ACME Corp');
    expect(serialized).not.toContain('123 Main St');
    expect(serialized).not.toContain('Building A');
    expect(serialized).not.toContain('Jane Doe');
    expect(serialized).not.toContain('Sensitive notes content');
  });

  it('never reads child row bodies (no photo URLs, no comment text)', () => {
    const out = sanitizeRecoveryLogMetadata({
      reportType: 'training',
      reportId: 'r2',
      snapshot: {
        parent: { id: 'p2' },
        children: {
          training_photos: [
            { photo_url: 'https://example.com/secret.jpg', caption: 'Private caption' },
          ],
          training_comments: [{ comment: 'Confidential comment body' }],
        },
      },
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('secret.jpg');
    expect(serialized).not.toContain('Private caption');
    expect(serialized).not.toContain('Confidential comment body');
    // But child counts are preserved.
    expect(out.childCounts).toEqual({ training_photos: 1, training_comments: 1 });
  });

  it('rejects unknown report types', () => {
    const out = sanitizeRecoveryLogMetadata({ reportType: 'malicious' });
    expect(out.reportType).toBeUndefined();
  });

  it('accepts the four known report types', () => {
    for (const rt of ['inspection', 'training', 'daily_assessment', 'daily-assessment']) {
      expect(sanitizeRecoveryLogMetadata({ reportType: rt }).reportType).toBe(rt);
    }
  });

  it('handles missing snapshot / parent / children safely', () => {
    expect(sanitizeRecoveryLogMetadata({ reportType: 'inspection', reportId: 'r1' })).toEqual({
      reportType: 'inspection',
      reportId: 'r1',
    });
    expect(
      sanitizeRecoveryLogMetadata({ reportId: 'r1', snapshot: { parent: null, children: null } }),
    ).toEqual({ reportId: 'r1' });
  });

  it('non-array child values count as 0', () => {
    const out = sanitizeRecoveryLogMetadata({
      snapshot: {
        children: { systems: 'not-an-array', items: [{}, {}] },
      },
    });
    expect(out.childCounts).toEqual({ systems: 0, items: 2 });
  });
});

describe('sanitizeRecoveryErrorForLog', () => {
  it('extracts name + message from Error', () => {
    expect(sanitizeRecoveryErrorForLog(new TypeError('boom'))).toEqual({
      name: 'TypeError',
      message: 'boom',
    });
  });

  it('falls back to Unknown error for null / undefined / empty', () => {
    expect(sanitizeRecoveryErrorForLog(null).message).toBe('Unknown error');
    expect(sanitizeRecoveryErrorForLog(undefined).message).toBe('Unknown error');
    expect(sanitizeRecoveryErrorForLog({}).message).toBe('Unknown error');
  });

  it('accepts string thrown values', () => {
    expect(sanitizeRecoveryErrorForLog('oops').message).toBe('oops');
  });

  it('does not include stack, cause, or nested payload-like properties', () => {
    const err = new Error('m') as Error & { cause?: unknown; response?: unknown };
    err.cause = { secret: 'classified-payload' };
    err.response = { body: { notes: 'classified-payload' } };
    const out = sanitizeRecoveryErrorForLog(err);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('classified-payload');
    expect(serialized).not.toContain('stack');
  });

  it('truncates very long messages', () => {
    const long = 'x'.repeat(1000);
    const out = sanitizeRecoveryErrorForLog(new Error(long));
    expect(out.message.length).toBeLessThanOrEqual(301);
    expect(out.message.endsWith('…')).toBe(true);
  });

  it('never throws on hostile getters', () => {
    const hostile = {
      get name() {
        throw new Error('boom');
      },
      get message() {
        throw new Error('boom');
      },
    };
    expect(() => sanitizeRecoveryErrorForLog(hostile)).not.toThrow();
  });
});
