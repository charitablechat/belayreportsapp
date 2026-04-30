import { describe, it, expect } from 'vitest';
import { extractFileExt } from '../file-ext';

describe('extractFileExt (audit M1)', () => {
  it('returns the lowercased extension when present', () => {
    expect(extractFileExt('photo.JPG')).toBe('jpg');
    expect(extractFileExt('photo.HEIC')).toBe('heic');
    expect(extractFileExt('photo.heif')).toBe('heif');
    expect(extractFileExt('photo.png')).toBe('png');
  });

  it('returns the fallback when the filename has no dot', () => {
    expect(extractFileExt('image')).toBe('jpg');
    expect(extractFileExt('AAAA-BBBB-CCCC')).toBe('jpg');
  });

  it('returns the fallback when the filename is empty', () => {
    expect(extractFileExt('')).toBe('jpg');
  });

  it('returns the fallback when the filename starts with a dot', () => {
    expect(extractFileExt('.gitignore')).toBe('jpg');
  });

  it('returns the fallback when the filename ends with a dot', () => {
    expect(extractFileExt('foo.')).toBe('jpg');
  });

  it('honors a custom fallback', () => {
    expect(extractFileExt('image', 'png')).toBe('png');
    expect(extractFileExt('', 'webp')).toBe('webp');
  });

  it('takes only the last segment for multi-dot names', () => {
    expect(extractFileExt('archive.tar.gz')).toBe('gz');
    expect(extractFileExt('photo.backup.HEIC')).toBe('heic');
  });

  it('strips URL query/hash tails when present', () => {
    expect(extractFileExt('photo.heic?token=abc')).toBe('heic');
    expect(extractFileExt('photo.jpg#fragment')).toBe('jpg');
  });
});
