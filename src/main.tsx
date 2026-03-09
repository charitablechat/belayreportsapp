import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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

// Service Worker initialization and auth token forwarding
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.ready.then((registration) => {
      if (import.meta.env.DEV) {
        console.log('[SW] Service Worker ready:', registration.scope);
      }
      // Send current auth token to SW on startup
      sendAuthTokenToSW();
    }).catch((error) => {
      if (import.meta.env.DEV) {
        console.error('[SW] Service Worker registration failed:', error);
      }
    });
  });
  
  // Listen for SW requesting a fresh auth token
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'REQUEST_AUTH_TOKEN') {
      sendAuthTokenToSW();
    }
  });
  
  // Forward token to SW whenever the Supabase session changes in localStorage
  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith('sb-') && event.key?.endsWith('-auth-token') && event.newValue) {
      sendAuthTokenToSW();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
