import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { pwaConfig } from "./vite-pwa-config";

// Version follows non-standard vX.Y.Z rollover scheme:
// - PATCH resets to .1 when reaching .10 (e.g., v2.3.9 → v2.4.1)
// - MINOR resets to .1 when reaching .10 (e.g., v2.9.9 → v3.1.1)
// See src/lib/version-calculator.ts for implementation
// v2.4.5 - Fixed equipment data loss: replaced object reference equality with ID-based matching
// v2.5.1 - Dual-layer lock protection (onPointerDownCapture), Minimal Brutalist dialog styling
// v2.5.2 - PWA cache-busting (skipWaiting/clientsClaim), Retro-Tech version badge
// v2.5.3 - Image CLS fix (decoding=async, Brutalist skeletons), silent photo refresh
// v2.5.4 - Photo flash fix: deferred object URL revocation, loaded state reset on src change
   const APP_VERSION = "2.5.4";
   const BUILD_DATE = "02-17-2026";
   const BUILD_TIMESTAMP = "02-17-2026 at 12:00 AM CST";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(APP_VERSION),
    'import.meta.env.BUILD_DATE': JSON.stringify(BUILD_DATE),
    'import.meta.env.BUILD_TIMESTAMP': JSON.stringify(BUILD_TIMESTAMP),
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    pwaConfig
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
