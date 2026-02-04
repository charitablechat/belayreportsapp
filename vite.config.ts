import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { pwaConfig } from "./vite-pwa-config";

// Version follows vX.Y.Z format where Z increments by 10 on each deployment
// v2.1.60 - Mobile sync fix: extended IndexedDB timeouts (10s) to prevent false empty returns on slow networks
const APP_VERSION = "2.1.60";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(APP_VERSION),
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
