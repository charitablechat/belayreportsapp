import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { isPreviewOrIframeEnvironment, isServiceWorkerAllowed } from "@/lib/environment";
import { initSentry } from "@/lib/sentry";
import { logError } from "@/lib/log-error";
import { registerSW } from "virtual:pwa-register";
import { isPhotoTraceEnabled } from "@/lib/photo-trace";

// Initialize error monitoring as early as possible (production-only, lazy-loaded).
void initSentry();

// TEMPORARY diagnostic — confirm photo-trace activation state on boot.
// Activate in any environment with `?photoTrace=1` (sticky via localStorage);
// disable with `?photoTrace=0`. See src/lib/photo-trace.ts.
if (isPhotoTraceEnabled()) {
  // eslint-disable-next-line no-console
  console.log('[photo-trace] enabled — window.__photoTrace ring buffer active');
}

// Global handlers — surface async failures that never reach a `try/catch`
// (e.g. orphaned promises, uncaught render errors below the React tree).
// Without these, `unhandledrejection` and `error` events are invisible to
// Sentry; the campaign hot paths (sync, IDB, save) all fire in async
// contexts where a missed `await` would otherwise be lost.
if (typeof window !== "undefined") {
  // Recovery hook for Safari/iOS storage-pressure IDB eviction. When
  // WebKit evicts the per-origin IndexedDB store mid-session, the next
  // transaction throws `UnknownError: Database deleted by request of
  // the user`. We catch it at the global `unhandledrejection` boundary,
  // force-close the stale connection (so the next `getDB()` re-opens
  // and recreates the schema via the existing upgrade path), and let
  // the sync loop repopulate from Supabase. Bounded to this single
  // recoverable condition — all other errors flow to `logError` as
  // before. Single-flight: guarded by `idbDeletionRecoveryInFlight`.
  let idbDeletionRecoveryInFlight = false;
  const maybeRecoverFromIdbDeletion = async (reason: unknown) => {
    try {
      const { isIdbDeletedError } = await import("@/lib/idb-closing-error");
      if (!isIdbDeletedError(reason)) return false;
      if (idbDeletionRecoveryInFlight) return true;
      idbDeletionRecoveryInFlight = true;
      try {
        const { forceCloseAndReopenDB } = await import("@/lib/offline-storage");
        await forceCloseAndReopenDB();
        try {
          window.dispatchEvent(new CustomEvent("idb-recovered-from-eviction"));
        } catch { /* ignore */ }
      } finally {
        idbDeletionRecoveryInFlight = false;
      }
      return true;
    } catch {
      return false;
    }
  };

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    // Try recovery first; suppress Sentry escalation if we handled it.
    // The classifier in sentry.ts also downgrades any leftover events
    // to `warning` so they never page on-call.
    void maybeRecoverFromIdbDeletion(reason);
    logError(reason ?? new Error("unhandledrejection (no reason)"), {
      scope: "global.unhandledrejection",
    });
  });
  window.addEventListener("error", (event) => {
    void maybeRecoverFromIdbDeletion(event.error);
    logError(event.error ?? new Error(event.message || "window.error"), {
      scope: "global.error",
      extra: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });
}

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
// owned here so preview/iframe contexts never receive a service worker while
// production installs always do, even after previous stale SW history).
if (isServiceWorkerAllowed()) {
  registerSW({ immediate: true });

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

// Phase 4–6 — reconnect-event wiring. Single-flight coordinator subscribes
// to online/visibility/pageshow/focus and fans into the registered runners
// (registered by useAutoSync on mount). Synchronous import so listeners
// are attached before the first navigation event can fire.
import { initReconnectEvents } from '@/lib/reconnect-events';
initReconnectEvents();

// Fix 1.D — one-time storage RLS probe (non-blocking, runs after mount).
Promise.resolve().then(() => {
  import('@/lib/storage-rls-probe').then(({ runStorageRlsProbeOnce }) => {
    runStorageRlsProbeOnce().catch(() => {});
  }).catch(() => {});
});

createRoot(document.getElementById("root")!).render(<App />);
