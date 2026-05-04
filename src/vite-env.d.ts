/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly BUILD_DATE: string;
  readonly BUILD_TIMESTAMP: string;
  readonly BUILD_COMMIT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
