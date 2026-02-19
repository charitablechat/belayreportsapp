

# Fix Auto-Versioning and Refresh Badge Aesthetic

## Root Cause

The `vite-auto-version.ts` plugin reads `version.json` (currently `"2.6.1"`), increments it in memory to `2.6.2`, and attempts to write the new value back to `version.json` via `fs.writeFileSync`. However, in the Lovable Cloud build environment, **file system writes do not persist between builds**. This means:

- Every build reads the stale `"2.6.1"` from disk.
- The plugin increments it to `"2.6.2"` in memory and injects it as `APP_VERSION`.
- The write-back to `version.json` is lost, so the next build repeats the same cycle.

The version has been stuck at `v2.6.2` for all recent deployments.

## Fix Strategy

Since the file-write-back mechanism cannot work in this environment, the solution is:

1. **Manually bump `version.json`** to `"2.8.1"` to account for the 15+ significant changes since `2.6.1` (active timer, admin settings, dark mode, dashboard polish, etc.).
2. **Accept the +1 increment model**: each build will always show the version stored in `version.json` + 1 patch. Future version bumps are done by updating `version.json` directly when shipping milestone features.
3. **Upgrade the VersionBadge** to use the Glassmorphism aesthetic (`backdrop-blur-md`, `bg-white/10`, Inter font) to match the current design system.

## Changes

### 1. `version.json`
Update from `"2.6.1"` to `"2.8.1"`. The next build will display `v2.8.2`.

### 2. `src/components/VersionBadge.tsx`
Restyle the badge button with the Minimal Glassmorphism aesthetic:
- Replace the retro-green terminal look with `backdrop-blur-md`, `bg-white/10`, `border-white/20`.
- Use `font-sans` (Inter) for the version text instead of `font-mono`.
- Maintain dark mode compatibility with `dark:` variants.
- Keep the click-to-open modal behavior intact.

### 3. `src/components/VersionInfoModal.tsx`
Upgrade the modal to Glassmorphism:
- Replace `bg-black border-2 border-white rounded-none` with `bg-black/90 backdrop-blur-xl border-white/20 rounded-lg`.
- Keep the CRT scanline overlay for the retro-tech character.
- Ensure the version number, build date, and timestamp remain clearly readable.

### 4. `vite-auto-version.ts`
Add a comment documenting the persistence limitation and the manual-bump workflow so future developers understand the pattern.

## Files Modified
- `version.json` -- bump to 2.8.1
- `src/components/VersionBadge.tsx` -- glassmorphism badge styling
- `src/components/VersionInfoModal.tsx` -- glassmorphism modal styling
- `vite-auto-version.ts` -- documentation comment

## No Impact On
- IndexedDB recovery guards (unrelated code path)
- localStorage snapshotting (unrelated)
- Auth logic in `AuthenticatedHeader.tsx` / `UserProfileDropdown.tsx` (badge is a leaf component, no auth coupling)
- No secrets or API keys involved

