import { describe, it, expect } from 'vitest';
import {
  derivePhotoStatus,
  LOVABLE_PREVIEW_UPLOAD_MESSAGE,
} from '../photo-status';

describe('derivePhotoStatus', () => {
  const now = 1_000_000_000_000;

  it('classifies a server-confirmed upload as "uploaded"', () => {
    const s = derivePhotoStatus({ uploaded: 1, uploadedAt: now - 1000 }, { now });
    expect(s.kind).toBe('uploaded');
    expect(s.label).toBe('Uploaded');
    expect(s.canRetry).toBe(false);
    expect(s.isServerSafe).toBe(true);
  });

  it('treats boolean `true` the same as numeric 1 (legacy rows)', () => {
    const s = derivePhotoStatus({ uploaded: true as unknown as 1 }, { now });
    expect(s.kind).toBe('uploaded');
  });

  it('returns "failed — tap to retry" when an error is stamped and backoff has elapsed', () => {
    const s = derivePhotoStatus(
      {
        uploaded: 0,
        lastError: 'network down',
        lastErrorAt: now - 60_000,
        nextRetryAt: now - 1_000, // backoff already past
        retryCount: 2,
      },
      { now, isOnline: true },
    );
    expect(s.kind).toBe('failed');
    expect(s.label).toBe('Upload failed — tap to retry');
    expect(s.canRetry).toBe(true);
    expect(s.isServerSafe).toBe(false);
    expect(s.isLocallySafe).toBe(true);
  });

  it('does NOT show "failed" while still inside a backoff window — shows "waiting"', () => {
    const s = derivePhotoStatus(
      {
        uploaded: 0,
        lastError: 'transient',
        lastErrorAt: now - 1_000,
        nextRetryAt: now + 10_000,
        retryCount: 1,
      },
      { now, isOnline: true },
    );
    expect(s.kind).toBe('waiting');
    expect(s.label).toBe('Waiting to upload');
    expect(s.canRetry).toBe(false);
  });

  it('does NOT flash "failed" for a brand-new photo before its first attempt', () => {
    const s = derivePhotoStatus(
      { uploaded: 0, lastError: 'somehow stamped', retryCount: 0 },
      { now, isOnline: true },
    );
    expect(s.kind).toBe('uploading');
  });

  it('returns "uploading" when online with no error', () => {
    const s = derivePhotoStatus({ uploaded: 0 }, { now, isOnline: true });
    expect(s.kind).toBe('uploading');
    expect(s.label).toBe('Uploading');
    expect(s.canRetry).toBe(false);
  });

  it('returns "saved on this device" when offline with no error', () => {
    const s = derivePhotoStatus({ uploaded: 0 }, { now, isOnline: false });
    expect(s.kind).toBe('saved-local');
    expect(s.label).toBe('Saved on this device');
    expect(s.isLocallySafe).toBe(true);
    expect(s.isServerSafe).toBe(false);
  });
});

describe('LOVABLE_PREVIEW_UPLOAD_MESSAGE', () => {
  it('mentions rwreports.com and the installed app, in plain English', () => {
    expect(LOVABLE_PREVIEW_UPLOAD_MESSAGE).toContain('rwreports.com');
    expect(LOVABLE_PREVIEW_UPLOAD_MESSAGE).toContain('installed app');
    expect(LOVABLE_PREVIEW_UPLOAD_MESSAGE).toContain('disabled in preview');
  });
});
