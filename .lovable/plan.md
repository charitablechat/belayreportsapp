

# Higher-Contrast Category Tabs

## Changes

**File: `src/pages/InspectionForm.tsx`** (lines 2081-2097)

### TabsList container
- Change `bg-muted/80 border-b-2 border-border` to `bg-zinc-800 border-b-2 border-zinc-700` -- a dark background that makes the entire tab bar stand out as a distinct navigation element.
- Add `rounded-lg` for a cleaner container look.

### Inactive TabsTriggers
- Change `text-muted-foreground` to `text-zinc-400` -- lighter gray on the dark background for readable but clearly "unselected" state.
- Change `hover:text-foreground` to `hover:text-zinc-100 hover:bg-zinc-700` -- bright hover feedback.

### Active TabsTrigger
- Change `data-[state=active]:bg-primary/10` to `data-[state=active]:bg-primary` -- full solid primary background (not a faint tint).
- Change `data-[state=active]:text-primary` to `data-[state=active]:text-primary-foreground` -- white/light text on the primary background.
- Keep `data-[state=active]:font-semibold`.
- Change `data-[state=active]:border-b-2 data-[state=active]:border-primary` to `data-[state=active]:shadow-md` -- a subtle elevation instead of underline (since the solid background already identifies the active tab).

This creates a dark navigation bar where inactive tabs are subdued gray and the active tab "pops" with a solid primary-colored highlight -- unmistakable at a glance.

