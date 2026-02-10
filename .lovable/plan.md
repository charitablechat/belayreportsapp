

# Make SyncPulse Tappable with Popup Details

## What is the yellow dot?

The yellow/amber dot with the number "5" is the **SyncPulse** component. It shows the total count of **unsynced items** -- reports and photos that are saved locally but haven't been uploaded to the server yet. Currently it only reveals details via a tooltip (hover), which is impractical on mobile touchscreens.

## Change

Replace the tooltip interaction with a **tappable popup** (using the existing Sheet/dialog pattern) that opens a detailed sync status panel when tapped. This works for both touch and click.

### What the popup will show

- **Sync status** (Syncing, Offline, Unsynced, All Synced, Error)
- **Last sync time** (e.g., "3m ago")
- **Pending report count** with a list showing organization and location for each
- **Pending photo count**
- **Error details** if sync has failed
- A note that sync happens automatically
- iOS-specific note about sync frequency

### Technical approach

**File: `src/components/pwa/SyncPulse.tsx`**

1. Replace the `Tooltip` wrapper with a `Sheet` (bottom drawer on mobile) from the existing UI library
2. Keep the dot + badge visual exactly as-is -- only the interaction changes from hover-tooltip to tap-to-open
3. Move all the informational content (currently in `TooltipContent`) into a `SheetContent` panel
4. Add slightly richer formatting in the sheet (section headers, better spacing) since we now have more room than a tooltip

The dot appearance, animations, and layout remain identical -- only the interaction model changes from tooltip to tappable sheet.

### No other files change

The `SyncPulse` component is self-contained. Dashboard.tsx simply renders `<SyncPulse />` and needs no modification.

