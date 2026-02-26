/**
 * Environment detection utilities.
 *
 * The Lovable preview iframe runs on a hostname like
 * `id-preview--<uuid>.lovable.app`. We use this to disable all
 * write operations so the preview never overwrites production data.
 */

let _isPreview: boolean | null = null;

export function isLovablePreview(): boolean {
  if (_isPreview === null) {
    try {
      _isPreview = window.location.hostname.includes('id-preview--');
    } catch {
      _isPreview = false;
    }
  }
  return _isPreview;
}
