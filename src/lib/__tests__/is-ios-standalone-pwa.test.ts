/**
 * isIOSStandalonePWA detection contract tests (audit PR-E).
 *
 * The StaleVersionBanner uses this helper to decide whether to surface
 * iOS-specific copy + the "fully close the app" fallback hint. Misdetection
 * either way is bad: false positive → Android users see iOS-only guidance;
 * false negative → iOS users see generic copy and don't get the cache-clear
 * + restart-hint paths that they actually need to recover from app-shell
 * staleness.
 *
 * navigator.standalone is non-standard but is the canonical iOS signal;
 * the W3C `display-mode: standalone` media query is supported on Android
 * Chrome and standalone Safari, so we can't rely on the media query alone.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isIOSStandalonePWA } from '../environment';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPADOS13_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

interface NavigatorMock {
  userAgent: string;
  standalone?: boolean;
  maxTouchPoints?: number;
}

function setNavigator(mock: NavigatorMock) {
  Object.defineProperty(window, 'navigator', {
    value: mock,
    configurable: true,
    writable: true,
  });
}

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: query === '(display-mode: standalone)' ? matches : false,
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    }),
    configurable: true,
    writable: true,
  });
}

const originalNavigator = window.navigator;
const originalMatchMedia = window.matchMedia;

describe('isIOSStandalonePWA', () => {
  beforeEach(() => {
    // jsdom default has no `standalone`; that's exactly what non-iOS clients see.
    setMatchMedia(false);
  });

  afterEach(() => {
    Object.defineProperty(window, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      value: originalMatchMedia,
      configurable: true,
      writable: true,
    });
  });

  it('returns true when navigator.standalone === true (canonical iOS signal)', () => {
    setNavigator({ userAgent: IPHONE_UA, standalone: true });
    expect(isIOSStandalonePWA()).toBe(true);
  });

  it('returns true on iPhone with display-mode standalone media query match', () => {
    setNavigator({ userAgent: IPHONE_UA });
    setMatchMedia(true);
    expect(isIOSStandalonePWA()).toBe(true);
  });

  it('returns true on iPad with display-mode standalone media query match', () => {
    setNavigator({ userAgent: IPAD_UA });
    setMatchMedia(true);
    expect(isIOSStandalonePWA()).toBe(true);
  });

  it('returns true on iPadOS 13+ (Macintosh UA + touch points) with media query match', () => {
    setNavigator({ userAgent: IPADOS13_UA, maxTouchPoints: 5 });
    setMatchMedia(true);
    expect(isIOSStandalonePWA()).toBe(true);
  });

  it('returns false on Android Chrome standalone PWA (display-mode matches but UA is not iOS)', () => {
    // Audit MEDIUM-1 root cause check: pre-PR-E we'd have shown iOS copy to
    // Android standalone users if we'd relied on the media query alone.
    setNavigator({ userAgent: ANDROID_UA });
    setMatchMedia(true);
    expect(isIOSStandalonePWA()).toBe(false);
  });

  it('returns false on regular macOS Chrome (no touch points)', () => {
    setNavigator({ userAgent: MAC_UA, maxTouchPoints: 0 });
    setMatchMedia(true);
    expect(isIOSStandalonePWA()).toBe(false);
  });

  it('returns false on iPhone Safari in browser tab (no standalone signal)', () => {
    setNavigator({ userAgent: IPHONE_UA });
    setMatchMedia(false);
    expect(isIOSStandalonePWA()).toBe(false);
  });

  it('returns false when navigator.standalone === false explicitly', () => {
    setNavigator({ userAgent: IPHONE_UA, standalone: false });
    setMatchMedia(false);
    expect(isIOSStandalonePWA()).toBe(false);
  });

  it('is SSR-safe when matchMedia is unavailable on iOS UA without standalone', () => {
    setNavigator({ userAgent: IPHONE_UA });
    Object.defineProperty(window, 'matchMedia', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(isIOSStandalonePWA()).toBe(false);
  });
});
