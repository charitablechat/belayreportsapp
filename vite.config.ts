import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { pwaConfig } from "./vite-pwa-config";
import { viteAutoVersion } from "./vite-auto-version";

// App version is auto-generated on every build by vite-auto-version.ts
// (PATCH = git commit count). See that plugin for the canonical scheme.

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    sourcemap: true,
  },
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
