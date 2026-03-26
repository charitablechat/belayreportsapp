

## Audit Results & Fix Plan: Offline Photo Caption Timeouts

### Findings

All four pieces of infrastructure exist but have these remaining bugs:

1. **`PhotoCaptionInput.tsx` line 131**: `disabled={disabled || isSaving}` blocks input during the 5-second Supabase timeout. For synced photos that lose connectivity mid-edit, the input freezes for 5 seconds before the safety timeout clears `isSaving`. The `isSaving` guard must be removed from the `disabled` prop.

2. **`PhotoCaptionInput.tsx` lines 59-62**: When a synced photo's user goes offline and no `onOfflineSave` prop is provided, the caption is silently dropped with just a console log. This means edits to *already-synced* photos while offline are lost entirely.

3. **`PhotoCaptionInput.tsx` line 14**: `onOfflineSave` prop typed as `(caption: string) => void` but receives async functions from PhotoGallery. Errors thrown by the async callback are unhandled, creating silent failures.

4. **`sync-manager.ts` line 109**: Already uses `photo.caption` — no change needed here.

### Changes

**`src/components/PhotoCaptionInput.tsx`**
- Remove `isSaving` from the `disabled` prop: change `disabled={disabled || isSaving}` to `disabled={disabled}`
- Change `onOfflineSave` prop type to `(caption: string) => void | Promise<void>` for clarity
- Add a fallback for synced photos going offline: when `!onOfflineSave && !isOnline`, queue the caption locally via `updateOfflinePhotoCaption` instead of silently dropping it, and update `lastSavedValueRef`

**`src/components/PhotoGallery.tsx`**
- No structural changes needed; the `onOfflineSave` callback for unsynced photos is already wired correctly
- Ensure the async callback in `onOfflineSave` catches errors internally (already does via try/catch)

### Files
| File | Change |
|------|--------|
| `src/components/PhotoCaptionInput.tsx` | Remove `isSaving` disabled guard; add offline fallback for synced photos; fix prop type |

