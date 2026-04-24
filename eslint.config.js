import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Fix 2.C — Ban raw localStorage.setItem in src/lib/** and src/hooks/**.
  // All writes must go through safeSetItem so failures are classified, audit-
  // logged, and surfaced to the user. See mem://architecture/storage-pressure-eviction.
  {
    files: ["src/lib/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='localStorage'][callee.property.name='setItem']",
          message:
            "Use safeSetItem from '@/lib/safe-local-storage' instead of localStorage.setItem. See mem://architecture/storage-pressure-eviction.",
        },
      ],
    },
  },
  // Allow-list — these files have purpose-built quota handling that would
  // conflict with the generic helper (auth-key pinning, encryption keystore,
  // migration-boot bypass, the helper itself, and tests).
  {
    files: [
      "src/lib/safe-local-storage.ts",
      "src/lib/auth-resilience.ts",
      "src/lib/auth-crypto.ts",
      "src/lib/offline-auth.ts",
      "src/lib/offline-storage.ts",
      "src/lib/sync-logger.ts",
      "src/lib/__tests__/**/*.{ts,tsx}",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
);
