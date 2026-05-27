/**
 * Zero-byte upload guards for ItemPhotoUpload.
 *
 * Background: Peaceable Kingdom inspection had 6 photos rendered as
 * broken placeholders because the Storage objects existed with 0 bytes
 * (mimetype set, size=0). The upload path had no guard on `compressed.size`
 * and no post-upload HEAD verification, so an empty Blob produced an
 * empty Storage object that markPhotoAsUploaded then locked in as "done".
 *
 * These tests exercise the predicate logic of the three guards in
 * isolation. The component itself is a large React tree; rather than
 * mount it, we replicate the predicates as small pure helpers and pin
 * the contract.
 */
import { describe, it, expect } from 'vitest';

/** Mirrors handleUpload guard #1 + #2 (compressed size check). */
function isAcceptableBlob(b: Blob | null | undefined): boolean {
  return !!b && b.size > 0;
}

/** Mirrors uploadInBackground guard #3 (post-upload HEAD integrity). */
function isAcceptableRemoteHead(res: { ok: boolean; contentLength: number }): boolean {
  return res.ok && res.contentLength > 0;
}

describe('ItemPhotoUpload zero-byte guards', () => {
  it('rejects a null blob', () => {
    expect(isAcceptableBlob(null)).toBe(false);
  });

  it('rejects a zero-byte blob', () => {
    expect(isAcceptableBlob(new Blob([]))).toBe(false);
  });

  it('accepts a non-empty blob', () => {
    expect(isAcceptableBlob(new Blob(['JPEGDATA']))).toBe(true);
  });

  it('rejects a remote HEAD response with content-length 0', () => {
    expect(isAcceptableRemoteHead({ ok: true, contentLength: 0 })).toBe(false);
  });

  it('rejects a remote HEAD response with non-2xx status', () => {
    expect(isAcceptableRemoteHead({ ok: false, contentLength: 12345 })).toBe(false);
  });

  it('accepts a remote HEAD response with positive content-length and ok=true', () => {
    expect(isAcceptableRemoteHead({ ok: true, contentLength: 12345 })).toBe(true);
  });
});
