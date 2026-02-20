

# Fix Data Recovery Sheet Mobile Text Wrapping and Button Visibility

## Root Cause
The mobile layout suffers from excessive nested padding and missing overflow controls:
- The `UserDataRecoverySheet` adds `px-3` padding
- Inside it, `LocalSnapshotsPanel` renders a `Card` with `CardHeader` (`p-6`) and `CardContent` (`p-6 pt-0`)
- That is ~36px sheet padding + 48px card padding = 84px+ of horizontal space lost on each side
- The `ScrollArea` viewport lacks `overflow-wrap: anywhere`, so long organization names and device strings break the layout
- The `CardDescription` text about "Immutable localStorage backups..." is a long unbroken sentence that overflows on narrow screens

## Changes

### 1. `src/components/admin/DataRecoveryTool.tsx` -- LocalSnapshotsPanel mobile fixes
- Reduce `CardHeader` padding on mobile: add `px-3 md:px-6 py-4 md:p-6` classes
- Reduce `CardContent` padding on mobile: add `px-3 md:px-6 pb-4 md:p-6 md:pt-0` classes
- Add `overflow-hidden` to the outer `Card` to prevent any content from escaping
- Add `break-words` and `overflow-wrap: anywhere` to the `CardDescription` so the stats text wraps
- On mobile snapshot cards: add `overflow-hidden` and ensure value spans use `overflow-wrap: anywhere` via inline style or a utility class, covering edge cases where `break-words` alone is insufficient (e.g., long device identifiers or UUIDs)
- Make the date text wrap properly by adding `break-words` to the "Last Saved" value span

### 2. `src/components/UserDataRecoverySheet.tsx` -- ScrollArea and layout fixes
- Add `overflow-hidden` to the outer `SheetContent` to prevent horizontal scroll at the sheet level
- Add `[&>div]:!overflow-x-hidden` or equivalent override on `ScrollArea` to ensure the Radix viewport does not allow horizontal scroll
- Reduce the ScrollArea height calc to `h-[calc(85vh-120px)]` to give slightly more breathing room for the header, preventing the last Restore button from being clipped at the bottom edge

### 3. Retro-Tech Terminal aesthetic alignment
- Add `font-mono` to the mobile snapshot cards for consistency with the established terminal aesthetic
- Use `text-xs` on value spans for a tighter, more terminal-like feel on mobile

## What Does NOT Change
- Desktop table layout remains identical
- No data recovery logic or API calls are modified
- No changes to the `LocalSnapshotsPanel` restore/export/delete handlers

## Files Modified
| File | Change |
|------|--------|
| `src/components/admin/DataRecoveryTool.tsx` | Tighten mobile padding on Card/CardHeader/CardContent, add overflow and word-wrap controls, add font-mono |
| `src/components/UserDataRecoverySheet.tsx` | Add overflow-hidden, adjust ScrollArea height, prevent horizontal scroll |
