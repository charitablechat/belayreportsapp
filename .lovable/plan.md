

# Silence Routine Toasts on Mobile During Data Entry

## Problem

You have a well-built notification criticality system (`notification-config.ts`) that classifies toasts as critical/standard/silent and routes non-critical ones to the Notification Center on mobile. However, **none of the three form pages use it**:

- `InspectionForm.tsx` and `TrainingForm.tsx` import `toast` from `@/hooks/use-toast` (shadcn toast) -- no mobile filtering at all
- `DailyAssessmentForm.tsx` imports `toast` directly from `sonner` -- also no filtering

This means every save, sync, and status message fires a full visual toast overlay while you're trying to enter data.

## Solution

Re-route all form toast calls through the filtered `toast` from `@/components/ui/sonner.tsx`, which already applies the criticality rules. Then expand the "silent" patterns to catch more routine messages.

## Changes

### 1. `src/pages/InspectionForm.tsx` -- Switch imports

- Remove: `import { toast } from "@/hooks/use-toast"` and `import { toast as sonnerToast } from "@/components/ui/sonner"`
- Add: `import { toast } from "@/components/ui/sonner"`
- Replace all `sonnerToast.xxx(...)` calls with `toast.xxx(...)`
- Convert shadcn-style `toast({ title, description, variant })` calls to sonner-style `toast.error(title, { description })` or `toast.success(title, { description })`
- Roughly 10 shadcn toast calls + 28 sonnerToast calls to migrate

### 2. `src/pages/TrainingForm.tsx` -- Switch imports

- Remove: `import { toast } from "@/hooks/use-toast"`
- Add: `import { toast } from "@/components/ui/sonner"`
- Convert all shadcn-style `toast({ title, description })` calls to sonner-style `toast.error(...)` / `toast.success(...)` / `toast.info(...)`
- Roughly 5 toast calls to migrate

### 3. `src/pages/DailyAssessmentForm.tsx` -- Switch imports

- Change: `import { toast } from "sonner"` to `import { toast } from "@/components/ui/sonner"`
- All existing `toast.success(...)` / `toast.error(...)` calls remain identical in syntax -- only the import changes
- No call-site changes needed

### 4. `src/lib/notification-config.ts` -- Expand silent patterns

Add more patterns to catch the routine messages that are most frequent during data entry:

```
/progress saved/i
/saved offline/i
/save successful/i
/summary (auto-)?updated/i
/saving changes before/i
/assessment submitted/i
/will sync (automatically )?when/i
```

These messages will be silently routed to the Notification Center on mobile (still visible in the bell icon) but will no longer interrupt data entry. Errors, failures, and connection issues will continue showing as toasts.

## What This Means for You

- **On mobile**: Routine "saved", "synced", "updated" messages disappear from the screen and go to the Notification Center (the bell icon). Errors still show as toasts.
- **On desktop**: No change -- all toasts still appear as normal.
- **Notification Center**: All messages (including silenced ones) are logged and reviewable anytime by tapping the bell icon.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Switch from shadcn/sonner imports to filtered toast |
| `src/pages/TrainingForm.tsx` | Switch from shadcn import to filtered toast |
| `src/pages/DailyAssessmentForm.tsx` | Switch from raw sonner import to filtered toast |
| `src/lib/notification-config.ts` | Add more silent patterns for routine form messages |

