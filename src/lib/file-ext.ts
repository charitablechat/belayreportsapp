/**
 * Audit M1: extract a usable file extension from a filename.
 *
 * `name.split('.').pop() || 'jpg'` is a buggy idiom: `'image'.split('.').pop()`
 * returns `'image'` (the whole string) — NOT `''` — so the `|| 'jpg'`
 * fallback never fires. iOS share-sheet / AirDrop uploads frequently
 * arrive without an extension, and the previous code happily wrote
 * `userId/inspId/photoId.image` into Supabase Storage. Some downstream
 * consumers (HTML / PDF report generators, Content-Type sniffing) key
 * off the extension and silently break.
 *
 * Returns a lowercased extension (without leading dot) when the file
 * has at least one `.` and a non-empty trailing segment; otherwise
 * the supplied fallback (default `'jpg'`).
 */
export function extractFileExt(name: string, fallback: string = 'jpg'): string {
  if (!name) return fallback;
  const lastDot = name.lastIndexOf('.');
  // No dot, or dot at the very start/end → no real extension.
  if (lastDot <= 0 || lastDot === name.length - 1) return fallback;
  const ext = name.slice(lastDot + 1).toLowerCase();
  // Strip any URL-like tail (?query#hash) that snuck in if the caller
  // accidentally passed a path/URL instead of a bare filename.
  const cleaned = ext.replace(/[?#].*$/, '');
  return cleaned || fallback;
}
