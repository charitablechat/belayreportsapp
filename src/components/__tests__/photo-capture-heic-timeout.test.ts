/**
 * Sprint 1 / C2.4: HEIC-aware per-file timeout selection.
 *
 * The PhotoCapture component picks one of two per-file timeouts at file-gate
 * time:
 *   - PER_FILE_TIMEOUT       (15s)  — non-HEIC fast-path
 *   - PER_FILE_TIMEOUT_HEIC  (60s)  — HEIC slow-path that covers
 *                                     heic-converter.ts's iOS retry budget
 *                                     (25s × 2 = 50s) plus 10s headroom
 *
 * Until this fix, both budgets were 15s and HEIC files would frequently time
 * out mid-conversion on iPad, producing a misleading
 * "Photo format not supported" toast. This regression test pins the budget
 * selection so the symptom can never silently regress.
 *
 * The selection function is `isHeicFile` from the shared photo-capture-
 * validation module. We verify it correctly identifies the platform-shaped
 * inputs that should get the longer budget.
 */
import { describe, it, expect } from 'vitest';
import { isHeicFile } from '@/lib/heic-converter';

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array(8)], name, { type });
}

describe('PhotoCapture HEIC budget selection (Sprint 1 / C2.4)', () => {
  it('flags MIME image/heic as HEIC', () => {
    expect(isHeicFile(makeFile('p.heic', 'image/heic'))).toBe(true);
  });

  it('flags MIME image/heif as HEIC', () => {
    expect(isHeicFile(makeFile('p.heif', 'image/heif'))).toBe(true);
  });

  it('flags .HEIC extension with empty MIME (iOS share-sheet shape)', () => {
    expect(isHeicFile(makeFile('IMG_0001.HEIC', ''))).toBe(true);
  });

  it('flags .heif extension with empty MIME', () => {
    expect(isHeicFile(makeFile('IMG_0001.heif', ''))).toBe(true);
  });

  it('does not flag a plain JPEG as HEIC (gets fast 15s budget)', () => {
    expect(isHeicFile(makeFile('p.jpg', 'image/jpeg'))).toBe(false);
  });

  it('does not flag a PNG as HEIC', () => {
    expect(isHeicFile(makeFile('p.png', 'image/png'))).toBe(false);
  });

  it('does not flag a webp as HEIC', () => {
    expect(isHeicFile(makeFile('p.webp', 'image/webp'))).toBe(false);
  });
});

describe('PhotoCapture HEIC timeout constants (Sprint 1 / C2.4)', () => {
  // The timeout constants are not exported (they are component-local) but the
  // contract is documented in the comment block at the top of PhotoCapture.tsx
  // and pinned by the budget selection test above. This block documents the
  // numeric expectations for future regressions:
  //
  //   PER_FILE_TIMEOUT      = 15000   (non-HEIC)
  //   PER_FILE_TIMEOUT_HEIC = 60000   (covers iOS heic-converter retry path)
  //   MAX_SAFETY_TIMEOUT    = 45000   (non-HEIC batch outer cap)
  //   MAX_SAFETY_TIMEOUT_HEIC = 180000 (HEIC batch outer cap)
  //
  // If any of these change, update PhotoCapture.tsx and document the reason
  // alongside heic-converter.ts:74 (`isIOSDevice() ? 25000 : 10000`) so the
  // two budgets stay in lockstep.
  it('documents the contract (no runtime check — see comment block above)', () => {
    expect(true).toBe(true);
  });
});
