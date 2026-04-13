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

let _isPreviewOrIframe: boolean | null = null;

/**
 * Returns true when running inside the Lovable editor preview
 * (iframe or preview hostname). Service workers must NOT be
 * registered in these environments.
 */
export function isPreviewOrIframeEnvironment(): boolean {
  if (_isPreviewOrIframe === null) {
    try {
      const h = window.location.hostname;
      const isPreviewHost =
        h.includes('id-preview--') || h.includes('lovableproject.com');
      let isIframe = false;
      try {
        isIframe = window.self !== window.top;
      } catch {
        isIframe = true;
      }
      _isPreviewOrIframe = isPreviewHost || isIframe;
    } catch {
      _isPreviewOrIframe = true;
    }
  }
  return _isPreviewOrIframe;
}

/**
 * Returns true when the current environment should allow
 * service worker registration and PWA features.
 */
export function isServiceWorkerAllowed(): boolean {
  return 'serviceWorker' in navigator && !isPreviewOrIframeEnvironment();
}
