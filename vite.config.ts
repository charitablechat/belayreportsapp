import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { pwaConfig } from "./vite-pwa-config";
import { viteAutoVersion } from "./vite-auto-version";

// Version follows non-standard vX.Y.Z rollover scheme:
// - PATCH resets to .1 when reaching .10 (e.g., v2.3.9 → v2.4.1)
// - MINOR resets to .1 when reaching .10 (e.g., v2.9.9 → v3.1.1)
// See src/lib/version-calculator.ts for implementation
// Version is auto-incremented on every build via vite-auto-version plugin

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    viteAutoVersion(),
    mode === "development" && componentTagger(),
    pwaConfig
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
}));
