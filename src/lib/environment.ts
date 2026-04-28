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

/**
 * Returns true when the running build is iOS Safari operating in standalone
 * (Add-to-Home-Screen) PWA mode. Detects via either:
 *  - `navigator.standalone === true` (iOS Safari's non-standard property), or
 *  - `display-mode: standalone` media query (the W3C-blessed signal that
 *    most platforms now also support).
 *
 * Why this lives here: iOS standalone PWAs boot from app-shell cache and can
 * serve stale JS even after a service-worker update. UX surfaces that prompt
 * the user to refresh (StaleVersionBanner, etc.) need iOS-aware copy and
 * cache-busting paths because a regular `location.reload()` is sometimes
 * not enough — the user may need to fully close and relaunch the PWA.
 *
 * SSR-safe: returns false when `navigator` / `window.matchMedia` are absent.
 */
export function isIOSStandalonePWA(): boolean {
  if (typeof navigator === 'undefined') return false;
  // navigator.standalone is non-standard but the canonical iOS signal.
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) {
    return true;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  // Restrict the media-query path to iOS user agents so we don't mis-flag
  // standalone Android Chrome (which has its own update story and doesn't
  // need the iOS-specific copy).
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac with touch support.
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  if (!isIOS) return false;
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}
