import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Service Worker logging (handled by vite-plugin-pwa)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.ready.then((registration) => {
      if (import.meta.env.DEV) {
        console.log('[SW] Service Worker ready:', registration.scope);
      }
    }).catch((error) => {
      if (import.meta.env.DEV) {
        console.error('[SW] Service Worker registration failed:', error);
      }
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
