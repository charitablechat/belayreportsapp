

# Fix: Invisible Lock Dialog (Black on Black)

## Root Cause

The "REPORT LOCKED" dialog **is functioning correctly** -- it opens when fields are clicked. The problem is purely visual: the dialog uses `bg-black` as its background, while the modal overlay behind it is `bg-black/80`. Black content on a near-black backdrop makes the dialog completely invisible to users, who perceive this as a "black screen crash."

I confirmed this by navigating to the completed report, clicking "Add System," and observing the overlay dim the page. The dialog was present in the DOM with correct text ("REPORT LOCKED", "Cancel", "Confirm Edit") but was visually indistinguishable from the backdrop.

## Solution

Change the dialog background from pure black to a dark color with enough contrast to stand out, and add a prominent green glow effect so it's unmistakably visible.

## File to Change

### `src/components/CompletionLockDialog.tsx`

Update `AlertDialogContent` classes:

**Current (line 22):**
```
bg-black border-double border-4 border-green-500 font-mono max-w-md relative overflow-hidden
```

**New:**
```
bg-zinc-950 border-double border-4 border-green-500 font-mono max-w-md relative overflow-hidden shadow-[0_0_40px_rgba(34,197,94,0.4)]
```

Changes:
- `bg-black` becomes `bg-zinc-950` -- still very dark but visually distinct from the pure-black overlay
- Add `shadow-[0_0_40px_rgba(34,197,94,0.4)]` -- a green glow around the dialog that makes it pop against the dark backdrop

No other files need to change. The lock mechanism, overlay, click interception, and state management are all working correctly.

