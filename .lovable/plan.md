

## Fix 3.C — Build-time DB version parity check

Add a Vite plugin that runs in the `buildStart` hook and fails the build if `public/db-config.js` and `src/lib/offline-storage.ts` declare different IndexedDB versions. Makes "forgot to bump one of the two" impossible to ship.

### Plan

#### 1. New file: `vite-db-version-check.ts`

Small Vite plugin (~30 lines) exporting `viteDbVersionCheck()`:

```ts
import fs from 'node:fs';
import type { Plugin } from 'vite';

export function viteDbVersionCheck(): Plugin {
  return {
    name: 'db-version-parity-check',
    buildStart() {
      const dbConfig = fs.readFileSync('public/db-config.js', 'utf8');
      const dbConfigVersion = Number(dbConfig.match(/version:\s*(\d+)/)?.[1]);

      const src = fs.readFileSync('src/lib/offline-storage.ts', 'utf8');
      const srcVersion = Number(src.match(/const DB_VERSION = (\d+)/)?.[1]);

      if (!Number.isFinite(dbConfigVersion) || !Number.isFinite(srcVersion)) {
        throw new Error(
          `[db-version-check] Could not parse DB version: ` +
          `public/db-config.js=${dbConfigVersion}, offline-storage.ts=${srcVersion}`
        );
      }

      if (dbConfigVersion !== srcVersion) {
        throw new Error(
          `[db-version-check] DB version mismatch: ` +
          `public/db-config.js=${dbConfigVersion} vs src/lib/offline-storage.ts=${srcVersion}. ` +
          `Both must match — bump together.`
        );
      }

      console.log(`[db-version-check] ✓ DB version parity OK (v${dbConfigVersion})`);
    },
  };
}
```

The regex `const DB_VERSION = (\d+)` matches the existing line in `offline-storage.ts:1177` exactly (no trailing `;` required so a future formatting change won't break it).

#### 2. Wire into `vite.config.ts`

Add the import and include the plugin in the `plugins` array (early, alongside `viteAutoVersion()`):

```ts
import { viteDbVersionCheck } from "./vite-db-version-check";
// ...
plugins: [
  react(),
  viteAutoVersion(),
  viteDbVersionCheck(),
  mode === "development" && componentTagger(),
  pwaConfig
].filter(Boolean),
```

`buildStart` fires for both `vite build` and `vite dev`, so mismatches surface immediately during local development too — not just on production builds.

### Out of scope

- No changes to the regexes in either source file. The current grep lands cleanly on both.
- No check against the four other `*_DB_VERSION` constants (auth-resilience, auth-crypto, offline-auth, idb-migration-safety) — those are independent sibling DBs with their own versions; only the main `rope-works-inspections` DB has the dual-declaration problem.
- No CI workflow changes — Vite's build step is the gate.

### Files touched

1. **`vite-db-version-check.ts`** — new plugin (~30 lines).
2. **`vite.config.ts`** — import + add to plugins array.

