import fs from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Build-time guard: fails the build if `public/db-config.js` (loaded by the
 * Service Worker) and `src/lib/offline-storage.ts` (used by the main thread)
 * declare different IndexedDB versions. Forgetting to bump one of the two
 * caused silent VersionError-on-sync failures historically; this plugin makes
 * the mismatch impossible to ship.
 */
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
