

# Fix: Photo Navigation Blocked in Locked Reports

## Root Cause

React's synthetic event system bubbles events through the **React component tree**, not the DOM tree. Even though the lightbox Dialog renders via a portal to `document.body`, clicks inside it still trigger `onClickCapture` on `<main>` because PhotoGallery is a React child of `<main>`.

The lightbox navigation arrows are `<button>` elements. The lock interceptor matches them as "editable" (`button` selector) but they lack `data-lightbox-trigger`, so clicks are blocked — preventing prev/next navigation and the close button.

## Fix

Add a single check to `handleLockedFieldClick` in all three form pages: if the click target is inside a `[role="dialog"]` element, allow it through. This covers:
- Lightbox prev/next arrows
- Lightbox close button
- Any future dialog interactions

This is cleaner than sprinkling `data-lightbox-trigger` on every button inside every dialog.

### Files to modify

**`src/pages/InspectionForm.tsx`** — line ~218, add dialog check:
```ts
const isInsideDialog = target.closest('[role="dialog"]');
if (!isEditable || isTabTrigger || isLightboxTrigger || isInsideDialog) return;
```

**`src/pages/TrainingForm.tsx`** — same change in equivalent `handleLockedFieldClick`.

**`src/pages/DailyAssessmentForm.tsx`** — same change in equivalent `handleLockedFieldClick`.

Three one-line changes, consistent across all report modules.

