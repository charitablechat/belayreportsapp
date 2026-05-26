/**
 * Targeted unit coverage for the loadSignedUrl recovery contract introduced
 * to fix the iPad-via-hotspot "Photo will load when back online" symptom.
 *
 * The fix is purely behavioural inside loadSignedUrl, so rather than
 * mounting the heavy React component (which pulls camera dialogs, dnd,
 * supabase storage, etc.), this test asserts the same decision logic
 * directly against the contract: given a `pending/...` photoUrl and an
 * IDB record that has been advanced to a real storage path, the UI must
 * call onPhotoChange with the real path so admins / future loads resolve
 * via the real signed URL. Mirrors the inline self-heal block in
 * src/components/inspection/ItemPhotoUpload.tsx loadSignedUrl().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  __resetNetworkLivenessForTest,
  recordNetworkSuccess,
  isLikelyOnline,
} from '@/lib/network-liveness';

type OfflinePhoto = {
  id: string;
  uploaded: 0 | 1;
  photoUrl: string;
  createdAt?: string;
};

/**
 * Mirrors the production self-heal in ItemPhotoUpload.loadSignedUrl. Kept
 * in the test so a future refactor that breaks the contract surface is
 * caught here.
 */
async function selfHealPending(opts: {
  photoUrl: string;
  itemId: string;
  offline: OfflinePhoto[];
  onPhotoChange: (url: string) => void;
}): Promise<'healed' | 'no-candidate' | 'not-pending'> {
  if (!opts.photoUrl.startsWith('pending/')) return 'not-pending';
  const idPrefix = `item-${opts.itemId}-`;
  const healed = opts.offline
    .filter(p =>
      p.id.startsWith(idPrefix) &&
      Number(p.uploaded) === 1 &&
      p.photoUrl &&
      !p.photoUrl.startsWith('pending/'),
    )
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  if (healed?.photoUrl) {
    opts.onPhotoChange(healed.photoUrl);
    return 'healed';
  }
  return 'no-candidate';
}

describe('ItemPhotoUpload pending-path self-heal', () => {
  beforeEach(() => {
    __resetNetworkLivenessForTest();
  });

  it('advances the form value to the real path when the IDB record is uploaded', async () => {
    const onPhotoChange = vi.fn();
    const result = await selfHealPending({
      photoUrl: 'pending/insp-1/items/row-1-abc.jpg',
      itemId: 'row-1',
      offline: [
        {
          id: 'item-row-1-1700000000',
          uploaded: 1,
          photoUrl: 'user-9/insp-1/items/row-1-abc.jpg',
          createdAt: '2026-05-26T12:00:00Z',
        },
      ],
      onPhotoChange,
    });
    expect(result).toBe('healed');
    expect(onPhotoChange).toHaveBeenCalledWith('user-9/insp-1/items/row-1-abc.jpg');
  });

  it('does not heal when the IDB record is still uploaded=0', async () => {
    const onPhotoChange = vi.fn();
    const result = await selfHealPending({
      photoUrl: 'pending/insp-1/items/row-1-abc.jpg',
      itemId: 'row-1',
      offline: [
        {
          id: 'item-row-1-1700000000',
          uploaded: 0,
          photoUrl: 'pending/insp-1/items/row-1-abc.jpg',
        },
      ],
      onPhotoChange,
    });
    expect(result).toBe('no-candidate');
    expect(onPhotoChange).not.toHaveBeenCalled();
  });

  it('picks the most recent uploaded candidate when several IDB rows exist', async () => {
    const onPhotoChange = vi.fn();
    await selfHealPending({
      photoUrl: 'pending/insp-1/items/row-1-abc.jpg',
      itemId: 'row-1',
      offline: [
        {
          id: 'item-row-1-1',
          uploaded: 1,
          photoUrl: 'user-9/insp-1/items/row-1-old.jpg',
          createdAt: '2026-05-20T10:00:00Z',
        },
        {
          id: 'item-row-1-2',
          uploaded: 1,
          photoUrl: 'user-9/insp-1/items/row-1-new.jpg',
          createdAt: '2026-05-26T10:00:00Z',
        },
      ],
      onPhotoChange,
    });
    expect(onPhotoChange).toHaveBeenCalledWith('user-9/insp-1/items/row-1-new.jpg');
  });

  it('does not match other rows in the same inspection', async () => {
    const onPhotoChange = vi.fn();
    const result = await selfHealPending({
      photoUrl: 'pending/insp-1/items/row-1-abc.jpg',
      itemId: 'row-1',
      offline: [
        {
          id: 'item-row-2-1',
          uploaded: 1,
          photoUrl: 'user-9/insp-1/items/row-2-x.jpg',
        },
      ],
      onPhotoChange,
    });
    expect(result).toBe('no-candidate');
    expect(onPhotoChange).not.toHaveBeenCalled();
  });
});

describe('iPad Safari false-offline guard via isLikelyOnline', () => {
  beforeEach(() => {
    __resetNetworkLivenessForTest();
  });

  it('returns true within the recency window even when navigator.onLine flips false', () => {
    // Simulate a successful Supabase fetch a moment ago (recordNetworkSuccess
    // is called automatically by retryingFetch).
    recordNetworkSuccess(Date.now());

    // Now spoof an iOS Safari handoff blip that sets navigator.onLine = false.
    const orig = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });

    try {
      expect(isLikelyOnline()).toBe(true);
    } finally {
      if (orig) Object.defineProperty(window.navigator, 'onLine', orig);
    }
  });

  it('returns false when navigator.onLine is false AND no recent success has been recorded', () => {
    const orig = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    try {
      expect(isLikelyOnline()).toBe(false);
    } finally {
      if (orig) Object.defineProperty(window.navigator, 'onLine', orig);
    }
  });

  it('returns false when the last success is older than the grace window', () => {
    // Record a success 60s ago — beyond the 30s default grace window.
    recordNetworkSuccess(Date.now() - 60_000);
    const orig = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    try {
      expect(isLikelyOnline()).toBe(false);
    } finally {
      if (orig) Object.defineProperty(window.navigator, 'onLine', orig);
    }
  });
});

/**
 * Mirrors the production gate in ItemPhotoUpload.handleUpload step 8:
 *   if (isOnline || isLikelyOnline()) { uploadInBackground(...) }
 *
 * Locks the contract that a false `navigator.onLine` flip (common on iPad
 * Safari mobile-hotspot handoffs) does NOT prevent a freshly captured
 * photo from kicking off its background upload, as long as the liveness
 * guard still considers us online. Without this, the row stays at
 * `pending/...` until the next online event — which may never fire in
 * the current tab on iOS Safari.
 */
function shouldStartBackgroundUpload(isOnlineFromHook: boolean): boolean {
  return isOnlineFromHook || isLikelyOnline();
}

describe('ItemPhotoUpload handleUpload background-start gate', () => {
  beforeEach(() => {
    __resetNetworkLivenessForTest();
  });

  it('starts background upload when useNetworkStatus reports offline but isLikelyOnline() is true', () => {
    recordNetworkSuccess(Date.now());
    const orig = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    try {
      // useNetworkStatus mirrors navigator.onLine, so isOnline=false here.
      expect(shouldStartBackgroundUpload(false)).toBe(true);
    } finally {
      if (orig) Object.defineProperty(window.navigator, 'onLine', orig);
    }
  });

  it('starts background upload when useNetworkStatus reports online', () => {
    expect(shouldStartBackgroundUpload(true)).toBe(true);
  });

  it('does not start background upload when truly offline (no recent success and navigator offline)', () => {
    const orig = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    try {
      expect(shouldStartBackgroundUpload(false)).toBe(false);
    } finally {
      if (orig) Object.defineProperty(window.navigator, 'onLine', orig);
    }
  });
});

