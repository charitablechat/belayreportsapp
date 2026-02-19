

# Auto-Increment Version on Every Build

## Problem
The version number (`v2.6.1`) is hardcoded in `vite.config.ts` and must be manually updated. The user wants it to automatically increment by one patch step (following the existing rollover scheme) every time the app rebuilds -- which in Lovable happens on every code edit.

## How It Works Today
- `APP_VERSION`, `BUILD_DATE`, and `BUILD_TIMESTAMP` are static strings on lines 20-22 of `vite.config.ts`
- The rollover logic already exists in `src/lib/version-calculator.ts` but is never called at build time

## Solution: Vite Plugin + JSON Version File

Create a small Vite plugin that runs at build start, reads the current version from a dedicated JSON file, increments it using the existing `version-calculator` logic, writes it back, and injects the new version + timestamp into `import.meta.env`.

A **debounce guard** (timestamp file) prevents double-increments when Vite's file watcher triggers multiple rebuilds in quick succession (< 5 seconds apart).

### New File: `version.json`
A single-purpose file storing the current version. This is the source of truth -- `vite.config.ts` no longer hardcodes the version string.

```json
{ "version": "2.6.1" }
```

### New File: `vite-auto-version.ts`
A Vite plugin that:
1. Reads `version.json`
2. Checks a `.version-timestamp` marker to skip if last increment was < 5 seconds ago (prevents infinite rebuild loops)
3. Increments using the rollover scheme (2.6.1 -> 2.6.2, 2.6.9 -> 2.7.1, 2.9.9 -> 3.1.1)
4. Writes the new version back to `version.json`
5. Returns `define` values for `APP_VERSION`, `BUILD_DATE`, and `BUILD_TIMESTAMP`

### Modified File: `vite.config.ts`
- Remove the hardcoded `APP_VERSION`, `BUILD_DATE`, `BUILD_TIMESTAMP` constants (lines 20-22)
- Remove the `define` block entries (lines 30-34)
- Import and use the new `vite-auto-version` plugin which handles both

## Technical Details

- The version-calculator functions (`parseVersion`, `getNextVersion`, `formatVersion`) are pure TypeScript with no browser dependencies, so they work in Node/Vite context via direct import
- The 5-second debounce prevents the write-to-`version.json` from triggering a Vite file-watch rebuild that would increment again
- `BUILD_TIMESTAMP` is generated dynamically using `Intl.DateTimeFormat` for CST timezone formatting, matching the current format ("MM-DD-YYYY at HH:MM AM/PM CST")
- The `.version-timestamp` marker file is added to `.gitignore`

## Rollover Scheme (unchanged)
- Patch increments by 1 each build: 2.6.1 -> 2.6.2 -> ... -> 2.6.9
- Patch 9 rolls over: 2.6.9 -> 2.7.1
- Minor 9 rolls over: 2.9.9 -> 3.1.1

