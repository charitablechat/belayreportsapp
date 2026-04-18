import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { isPreviewOrIframeEnvironment, isServiceWorkerAllowed } from "@/lib/environment";

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

createRoot(document.getElementById("root")!).render(<App />);
