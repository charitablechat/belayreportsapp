/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly BUILD_DATE: string;
  readonly BUILD_TIMESTAMP: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
