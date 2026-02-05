import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { pwaConfig } from "./vite-pwa-config";

// Version follows vX.Y.Z format where Z increments by 10 on each deployment
 // v2.2.92 - SMS/Text Report Sharing: share report metadata via native messaging
 const APP_VERSION = "2.2.92";
 const BUILD_DATE = "02-05-2026";
 const BUILD_TIMESTAMP = "02-05-2026 at 11:00 AM CST";

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
