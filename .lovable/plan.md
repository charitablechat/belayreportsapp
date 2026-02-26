

## Add Visible "Last Saved" Timestamp on All Report Forms

### Current Behavior
- The `AutoSaveIndicator` component already exists on all three report forms (Inspection, Training, Daily Assessment)
- On desktop, it shows relative time like "Saved just now" or "Saved 2m ago"
- On mobile, the text is **completely hidden** (`hidden sm:inline`) -- only the icon is visible
- The precise timestamp (e.g., "2:45:12 PM") is never shown

### Changes

**Single file change: `src/components/AutoSaveIndicator.tsx`**

1. **Always show the precise time on mobile** -- replace `sm:hidden` with a short format like "2:45 PM" instead of just "Saved"
2. **Show precise timestamp on desktop** -- change desktop text from "Saved just now" to "Saved at 2:45:12 PM" so users see exactly when their data was persisted
3. Keep the relative time as a secondary detail (e.g., "Saved at 2:45 PM (just now)") on desktop only, for context

### Result
- Mobile: `[checkmark] Saved 2:45 PM`
- Desktop: `[checkmark] Saved at 2:45:12 PM`
- No changes needed to the three form files since they already pass `lastSaved` to the component

### Technical Detail
- Update the `formatTime` function and the JSX in the "lastSaved" render block
- Use `format(date, "h:mm a")` for mobile and `format(date, "h:mm:ss a")` for desktop
- Remove the current relative-time logic (which was less useful for confirming data safety)

