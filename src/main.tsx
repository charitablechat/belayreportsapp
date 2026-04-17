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
 * Send the current user's JWT access token to all service workers.
 * This enables sw-sync.js to authenticate as the user for RLS-protected operations.
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
    // Non-critical — SW sync will skip if no token available
  }
}

// Service Worker initialization — only in production (non-preview, non-iframe)
if (isServiceWorkerAllowed()) {
  window.addEventListener('load', () => {
    // Force every SW script fetch to bypass HTTP cache (critical on iOS/macOS Safari,
    // which otherwise honors a 24h cache on the SW script and delays update delivery).
    navigator.serviceWorker.getRegistration().then((existing) => {
      if (!existing) {
        navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
      }
    }).catch(() => {});

    navigator.serviceWorker.ready.then((registration) => {
      if (import.meta.env.DEV) {
        console.log('[SW] Service Worker ready:', registration.scope);
      }
      sendAuthTokenToSW();
    }).catch((error) => {
      if (import.meta.env.DEV) {
        console.error('[SW] Service Worker registration failed:', error);
      }
    });
  });
  
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
