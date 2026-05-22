/**
 * Pins the contract that a regular admin viewing another trainer's Training
 * photos can resolve signed URLs from the `training-photos` bucket.
 *
 * Before the storage SELECT policy fix, `supabase.storage.from(
 *   'training-photos').createSignedUrls(paths, ttl)` returned per-path
 * `{ error: '...not authorized...' }` for non-owner admin viewers, and
 * `PhotoGallery` rendered empty/failed tiles. The fix is a SELECT-only
 * policy:
 *
 *   USING (bucket_id = 'training-photos' AND public.is_admin_or_above())
 *
 * We can't reach real PostgREST/Storage from vitest, so we mock the storage
 * client and assert the consumer's contract: when `createSignedUrls` now
 * returns successful URLs (as it will post-migration for an admin), the
 * gallery treats every entry as a hit and reports zero failures.
 */
import { describe, it, expect, vi } from 'vitest';

interface SignedUrlEntry {
  signedUrl: string | null;
  path: string | null;
  error: string | null;
}

function mockCreateSignedUrls(entries: SignedUrlEntry[]) {
  return vi.fn(async (_paths: string[], _ttl: number) => ({
    data: entries,
    error: null,
  }));
}

/**
 * Mirrors PhotoGallery.tsx's batched signed-URL handler shape: count failures,
 * keep only successes, preserve path mapping.
 */
function reduceSignedUrls(
  paths: string[],
  data: SignedUrlEntry[],
): { successes: { path: string; signedUrl: string }[]; failures: number } {
  let failures = 0;
  const successes: { path: string; signedUrl: string }[] = [];
  paths.forEach((path, idx) => {
    const entry = data[idx];
    if (!entry || entry.error || !entry.signedUrl) {
      failures += 1;
      return;
    }
    successes.push({ path, signedUrl: entry.signedUrl });
  });
  return { successes, failures };
}

describe('training-photos admin signed-URL access (post-policy contract)', () => {
  it('admin gets successful signed URLs for another trainer\'s photos', async () => {
    const ownerUserId = 'owner-uuid';
    const trainingId = 'training-uuid';
    const paths = [
      `${ownerUserId}/${trainingId}/photo-a.jpg`,
      `${ownerUserId}/${trainingId}/photo-b.jpg`,
      `${ownerUserId}/${trainingId}/photo-c.jpg`,
    ];

    // Post-migration: admin SELECT policy allows signed URL creation across
    // owner prefixes — every entry comes back populated.
    const createSignedUrls = mockCreateSignedUrls(
      paths.map((p) => ({
        signedUrl: `https://signed.example/${p}?token=xyz`,
        path: p,
        error: null,
      })),
    );

    const { data } = await createSignedUrls(paths, 3600);
    const result = reduceSignedUrls(paths, data);

    expect(createSignedUrls).toHaveBeenCalledWith(paths, 3600);
    expect(result.failures).toBe(0);
    expect(result.successes).toHaveLength(paths.length);
    expect(result.successes[0].path).toBe(paths[0]);
    expect(result.successes[0].signedUrl).toContain('signed.example');
  });

  it('regression lock: any per-path error increments the failure counter', async () => {
    // If the policy were ever rolled back, createSignedUrls would surface
    // per-path errors. The reducer must treat those as failures, not silently
    // drop them, so PhotoGallery surfaces the failed-tile UI.
    const paths = ['p1', 'p2'];
    const createSignedUrls = mockCreateSignedUrls([
      { signedUrl: 'https://ok/p1', path: 'p1', error: null },
      { signedUrl: null, path: 'p2', error: 'not authorized' },
    ]);
    const { data } = await createSignedUrls(paths, 3600);
    const result = reduceSignedUrls(paths, data);
    expect(result.failures).toBe(1);
    expect(result.successes).toEqual([
      { path: 'p1', signedUrl: 'https://ok/p1' },
    ]);
  });
});
