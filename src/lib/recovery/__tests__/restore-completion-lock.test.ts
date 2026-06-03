import { describe, it, expect } from 'vitest';
import { isReportCompletedLocked } from '@/lib/recovery/restore-completion-lock';

describe('isReportCompletedLocked', () => {
  it('returns false for null live parent', () => {
    expect(isReportCompletedLocked({ liveParent: null })).toBe(false);
  });

  it('returns false for undefined live parent', () => {
    expect(isReportCompletedLocked({ liveParent: undefined })).toBe(false);
  });

  it('returns false for live parent without status', () => {
    expect(isReportCompletedLocked({ liveParent: { id: 'x' } })).toBe(false);
  });

  it('returns false for status="draft"', () => {
    expect(isReportCompletedLocked({ liveParent: { status: 'draft' } })).toBe(false);
  });

  it('returns false for status="in_progress"', () => {
    expect(isReportCompletedLocked({ liveParent: { status: 'in_progress' } })).toBe(false);
  });

  it('returns true for status="completed"', () => {
    expect(isReportCompletedLocked({ liveParent: { status: 'completed' } })).toBe(true);
  });

  it('returns false for non-string status', () => {
    expect(isReportCompletedLocked({ liveParent: { status: 1 } })).toBe(false);
    expect(isReportCompletedLocked({ liveParent: { status: true } })).toBe(false);
  });
});
