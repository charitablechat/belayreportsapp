import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { isPreviewOrIframeEnvironment, isServiceWorkerAllowed } from "@/lib/environment";
import { initSentry } from "@/lib/sentry";

// Initialize error monitoring as early as possible (production-only, lazy-loaded).
void initSentry();

// Guard: unregister stale service workers in preview/iframe contexts
if (isPreviewOrIframeEnvironment()) {
  navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
}

/**
 * Send the current user's JWT access token to the active service worker.
 * Enables sw-sync.js to authenticate as the user for RLS-protected operations.
 */
function sendAuthTokenToSW() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  try {
    const sessionKey = `sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`;
    const sessionRaw = localStorage.getItem(sessionKey);
    if (!sessionRaw) return;
    const session = JSON.parse(sessionRaw);
    if (!session?.access_token || !session?.expires_at) return;
    navigator.serviceWorker.controller.postMessage({
      type: 'AUTH_TOKEN',
      accessToken: session.access_token,
      expiresAt: session.expires_at
    });
  } catch {
    // Non-critical
  }
}

// Auth-token bridge for sw-sync.js (the actual SW registration is now
// owned by VitePWA's auto-injected register script — we only listen for
// readiness so we can ship the JWT to it).
if (isServiceWorkerAllowed()) {
  navigator.serviceWorker.ready.then(() => {
    if (import.meta.env.DEV) {
      console.log('[SW] Service Worker ready — sending auth token');
    }
    sendAuthTokenToSW();
  }).catch(() => {});

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'REQUEST_AUTH_TOKEN') {
      sendAuthTokenToSW();
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith('sb-') && event.key?.endsWith('-auth-token') && event.newValue) {
      sendAuthTokenToSW();
    }
  });
}

// One-time migration: reset photo retryCount so previously-dead photos
// get one fresh upload attempt after the dead-letter filter is introduced.
const PHOTO_RETRY_RESET_FLAG = 'photo-retry-reset-v1';
if (typeof localStorage !== 'undefined' && !localStorage.getItem(PHOTO_RETRY_RESET_FLAG)) {
  import('@/lib/offline-storage').then(({ resetPhotoRetryCounts }) => {
    resetPhotoRetryCounts().then((count) => {
      try { localStorage.setItem(PHOTO_RETRY_RESET_FLAG, String(Date.now())); } catch {}
      if (import.meta.env.DEV) {
        console.log(`[Boot] Photo retry-count reset migration ran (${count} photos)`);
      }
    }).catch(() => {});
  }).catch(() => {});
}

// S23: One-time backfill of `capturedByUserId` for legacy `pending/` photos.
// Safe to run on every boot — the helper is idempotent and only acts when
// exactly one user-id is known on this device.
const PHOTO_CAPTURED_BY_BACKFILL_FLAG = 'photo-captured-by-backfill-v1';
if (typeof localStorage !== 'undefined' && !localStorage.getItem(PHOTO_CAPTURED_BY_BACKFILL_FLAG)) {
  import('@/lib/offline-storage').then(({ backfillCapturedByUserIdForPendingPhotos }) => {
    backfillCapturedByUserIdForPendingPhotos().then((count) => {
      try { localStorage.setItem(PHOTO_CAPTURED_BY_BACKFILL_FLAG, String(Date.now())); } catch {}
      if (import.meta.env.DEV) {
        console.log(`[Boot] S23 capturedByUserId backfill ran (${count} photos tagged)`);
      }
    }).catch(() => {});
  }).catch(() => {});
}

// Phase 1 — auth resilience: validate stored credential slots and discard
// any half-written `.tmp` rows from a previous crash. Non-blocking; runs in
// the background so React can mount immediately.
import('@/lib/auth-resilience').then(({ validateAuthStateOnBoot }) => {
  validateAuthStateOnBoot().then((result) => {
    if (import.meta.env.DEV && (result.recovered || !result.ok)) {
      console.log('[AuthResilience] Boot validation:', result);
    }
  }).catch(() => {});
}).catch(() => {});

// Phase 2 — auth state machine bridge: subscribe to Supabase auth events
// and browser online/offline so the FSM stays in sync. Synchronous import
// so the seed transition runs before React mounts and RequireAuth sees a
// real state on first render.
import { initAuthBridge } from '@/lib/auth-bridge';
initAuthBridge();

// Fix 1.D — one-time storage RLS probe (non-blocking, runs after mount).
Promise.resolve().then(() => {
  import('@/lib/storage-rls-probe').then(({ runStorageRlsProbeOnce }) => {
    runStorageRlsProbeOnce().catch(() => {});
  }).catch(() => {});
});

createRoot(document.getElementById("root")!).render(<App />);
