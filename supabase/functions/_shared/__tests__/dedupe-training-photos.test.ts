import { describe, it, expect } from 'vitest';
import { dedupeTrainingPhotos } from '../dedupe-training-photos';

/**
 * Regression coverage for the Training Report photo-duplication audit.
 *
 * The Training Report photo pipeline funnels every row through
 * `fetchTrainingData` → `formatTrainingContent` → the single
 * `photoUrls.map(...)` rendering loop in `generate-training-html` and the
 * single `for (const photo of trainingData.photos)` loop in
 * `generate-training-pdf`. There is exactly ONE iteration site per
 * generator, so if duplicate images appear in the final report the cause
 * is upstream: duplicate rows reach the formatter. These tests pin the
 * upstream dedupe contract so the bug cannot return regardless of how
 * the duplicates were introduced (legacy data, a future insert
 * regression, or a temporary index outage).
 */
describe('dedupeTrainingPhotos', () => {
  it('renders each unique photo exactly once (two genuinely distinct photos kept)', () => {
    const photos = [
      { id: 'a', photo_url: 'org/t1/photo-A.jpg', caption: 'Belay setup' },
      { id: 'b', photo_url: 'org/t1/photo-B.jpg', caption: 'Anchor check' },
    ];
    const out = dedupeTrainingPhotos(photos);
    expect(out.map((p) => p.photo_url)).toEqual([
      'org/t1/photo-A.jpg',
      'org/t1/photo-B.jpg',
    ]);
  });

  it('collapses a local-pending + synced-remote pair (same photo_url) into one render', () => {
    // Simulates the historical race: an offline-pending row and the
    // server-confirmed row land in the same `fetchTrainingData` result
    // pointing at the same storage object. The generated report must
    // show this logical photo exactly once.
    const photos = [
      { id: 'pending-local-1', photo_url: 'org/t1/photo-A.jpg', caption: 'pending' },
      { id: 'synced-remote-1', photo_url: 'org/t1/photo-A.jpg', caption: 'synced' },
    ];
    const out = dedupeTrainingPhotos(photos);
    expect(out).toHaveLength(1);
    // First-occurrence-wins under the caller's display_order ordering.
    expect(out[0].id).toBe('pending-local-1');
  });

  it('does NOT dedupe by filename — two different uploads sharing a filename both render', () => {
    // Hard-coded scope rule from the audit prompt: filename alone is not
    // a stable identity. Two users can upload `image.jpg` at different
    // storage paths and both deserve to appear in the report.
    const photos = [
      { id: 'a', photo_url: 'org/t1/2026-05-22/image.jpg' },
      { id: 'b', photo_url: 'org/t1/2026-05-23/image.jpg' },
    ];
    const out = dedupeTrainingPhotos(photos);
    expect(out.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('passes rows with missing photo_url through (never silently drops a genuine photo)', () => {
    const photos = [
      { id: 'a', photo_url: 'org/t1/photo-A.jpg' },
      { id: 'b', photo_url: null },
      { id: 'c', photo_url: undefined },
      { id: 'd', photo_url: '' },
    ];
    const out = dedupeTrainingPhotos(photos);
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('regression: the single render loop receives a deduped array, so HTML emits one <img> per logical photo', () => {
    // Mirrors the exact iteration done by
    // generate-training-html (`photoUrls.map(...)`) and
    // generate-training-pdf (`for (const photo of trainingData.photos)`).
    // Feed a worst-case input where the same `photo_url` repeats three
    // times alongside one genuinely distinct photo. After dedupe the
    // render loop must emit exactly two <img> tags.
    const photos = [
      { id: '1', photo_url: 'org/t1/A.jpg', caption: 'first' },
      { id: '2', photo_url: 'org/t1/A.jpg', caption: 'dup-1' },
      { id: '3', photo_url: 'org/t1/A.jpg', caption: 'dup-2' },
      { id: '4', photo_url: 'org/t1/B.jpg', caption: 'distinct' },
    ];
    const deduped = dedupeTrainingPhotos(photos);
    const renderedHtml = deduped
      .map((p) => `<img src="${p.photo_url}" alt="${p.caption ?? ''}" />`)
      .join('');
    const imgMatches = renderedHtml.match(/<img /g) ?? [];
    expect(imgMatches).toHaveLength(2);
    expect(renderedHtml).toContain('src="org/t1/A.jpg"');
    expect(renderedHtml).toContain('src="org/t1/B.jpg"');
  });

  it('preserves caller ordering (display_order) — kept rows appear in input order', () => {
    const photos = [
      { id: '1', photo_url: 'A' },
      { id: '2', photo_url: 'B' },
      { id: '3', photo_url: 'A' }, // duplicate of #1, must be dropped
      { id: '4', photo_url: 'C' },
    ];
    expect(dedupeTrainingPhotos(photos).map((p) => p.id)).toEqual(['1', '2', '4']);
  });
});
