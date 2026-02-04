import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { pwaConfig } from "./vite-pwa-config";

// Version follows vX.Y.Z format where Z increments by 10 on each deployment
// v2.1.40 - Dashboard loading fix: safety timeout prevents skeleton loaders from getting stuck, network query timeouts for all data fetches
const APP_VERSION = "2.1.40";

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
