import { describe, it, expect } from 'vitest';
import { isRescueEligible } from '@/lib/photo-rescue-sweep';
import { MAX_PHOTO_RETRIES } from '@/lib/offline-storage';

const USER = 'user-1';
const NOW = 1_700_000_000_000;
const STUCK_AGE = 24 * 60 * 60 * 1000;

const fakeBlob = new Blob(['x'], { type: 'image/jpeg' });

const base = () => ({
  uploaded: 0 as 0 | 1,
  blob: fakeBlob,
  retryCount: 0,
  nextRetryAt: null as number | null,
  lastError: null as string | null,
  timestamp: NOW - STUCK_AGE - 1000,
  capturedByUserId: USER as string | null,
});

describe('photo-rescue-sweep / isRescueEligible', () => {
  it('rescues a dead-lettered photo', () => {
    const r = isRescueEligible({ ...base(), retryCount: MAX_PHOTO_RETRIES }, USER, NOW);
    expect(r.eligible).toBe(true);
  });

  it('rescues a long-stuck "0,0,null" photo', () => {
    expect(isRescueEligible(base(), USER, NOW).eligible).toBe(true);
  });

  it('skips when blob is missing', () => {
    const r = isRescueEligible({ ...base(), blob: null, retryCount: MAX_PHOTO_RETRIES }, USER, NOW);
    expect(r).toEqual({ eligible: false, reason: 'no-blob' });
  });

  it('skips when captured by a different user', () => {
    const r = isRescueEligible(
      { ...base(), capturedByUserId: 'other-user', retryCount: MAX_PHOTO_RETRIES },
      USER,
      NOW,
    );
    expect(r).toEqual({ eligible: false, reason: 'other-user' });
  });

  it('allows null capturedByUserId (legacy untagged)', () => {
    const r = isRescueEligible(
      { ...base(), capturedByUserId: null, retryCount: MAX_PHOTO_RETRIES },
      USER,
      NOW,
    );
    expect(r.eligible).toBe(true);
  });

  it('skips a photo already rescued (idempotent)', () => {
    const r = isRescueEligible(
      { ...base(), retryCount: MAX_PHOTO_RETRIES, rescuedAt: NOW - 1000 },
      USER,
      NOW,
    );
    expect(r).toEqual({ eligible: false, reason: 'already-rescued' });
  });

  it('skips already-uploaded photos', () => {
    const r = isRescueEligible({ ...base(), uploaded: 1 as 0 | 1 }, USER, NOW);
    expect(r.eligible).toBe(false);
  });

  it('skips a young photo with no errors (not stuck yet, not dead)', () => {
    const r = isRescueEligible({ ...base(), timestamp: NOW - 1000 }, USER, NOW);
    expect(r).toEqual({ eligible: false, reason: 'not-stuck-or-dead' });
  });

  it('skips a photo currently in normal backoff window', () => {
    const r = isRescueEligible(
      { ...base(), retryCount: 2, nextRetryAt: NOW + 5000, lastError: 'flake' },
      USER,
      NOW,
    );
    expect(r.eligible).toBe(false);
  });
});
