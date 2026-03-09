
The bamboo background is defined in `src/lib/background-manager.ts` as `bg07` and imported from `src/assets/backgrounds/bg-07-bamboo.png`.

**Change Required:**
- Remove the import statement: `import bg07 from "@/assets/backgrounds/bg-07-bamboo.png";`
- Remove `bg07` from the `backgrounds` array (currently at index 6)

Result: The bamboo background will no longer be randomly selected for new sessions. The array will contain 16 backgrounds instead of 17. No other changes needed — the selection logic remains unchanged.

**File to modify:** `src/lib/background-manager.ts`
