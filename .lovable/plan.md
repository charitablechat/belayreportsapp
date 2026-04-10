

# Back Button Navigation Audit Report & Fix Plan

## Architecture Overview

The app has **four competing `popstate` listeners** that coordinate via global flags:

1. **App.tsx root listener** — exit guard + depth tracking
2. **useReportTabHistory** — tab-level back navigation in report forms
3. **PhotoGallery lightbox** — close lightbox on back
4. **ItemPhotoUpload lightbox** — close lightbox on back

Coordination relies on two global booleans: `overlayActive` and `reportTabActive`.

---

## Audit Findings

### BUG 1: Tablet devices get NO tab-back navigation (HIGH)

**Root cause:** `useReportTabHistory` gates everything on `isMobile()` from `mobile-detection.ts`, which checks user-agent strings only. iPads with iPadOS 13+ report a **desktop** user-agent (`Macintosh`), and many Android tablets also fail this check. The `isMobile()` function does NOT check screen width.

**Impact:** On tablets, pressing the browser/hardware back button inside a report form navigates away from the report entirely (falls through to App.tsx root handler) instead of going to the previous tab. This is the most critical issue.

**Affected pages:** InspectionForm, TrainingForm, DailyAssessmentForm

### BUG 2: `navigationDepth` counter drifts out of sync (MEDIUM)

**Root cause:** Multiple history entries are pushed by different systems (lovableGuard, reportTab entries, lightbox entries) but `navigationDepth` only tracks React Router location changes. When the App.tsx popstate handler fires and calls `decrementNavigation()`, it may decrement for history pops that were pushed by lightbox/tab code — entries that were never counted by `trackNavigation()`.

**Impact:** After opening/closing lightboxes or switching tabs, `navigationDepth` can reach 0 prematurely. The next back press redirects to `/dashboard` instead of the actual previous page.

### BUG 3: Competing popstate listeners — no guaranteed execution order (MEDIUM)

**Root cause:** Four `addEventListener('popstate', ...)` calls are active simultaneously inside report forms. When back is pressed:
- App.tsx handler fires — checks `isOverlayActive()` / `isReportTabActive()` and bails
- Report tab handler fires — handles tab navigation
- Lightbox handler fires — may also run

The order depends on registration timing, and React effect cleanup/re-registration can change it. If the App.tsx handler runs before the overlay flag is set (race on effect mount timing), it will process the event AND the overlay handler will also process it — double-handling.

**Specific scenario:** Open report → open lightbox → press back. Both the lightbox `onPopState` and App.tsx `handlePopState` fire. App.tsx checks `isOverlayActive()` which is `true`, so it returns early — this works. But if the lightbox effect cleanup runs slightly before and sets `overlayActive = false`, the App.tsx handler will process the pop and decrement the depth counter incorrectly.

### BUG 4: PhotoGallery effect dependency uses boolean expression (LOW)

**Root cause:** `useEffect` dependency is `[selectedPhotoIndex !== null]` — a computed boolean. This means the effect re-runs only on `null ↔ non-null` transitions, which is correct for open/close. However, it re-registers the popstate listener on every open, pushing a new history entry each time. If the lightbox is closed via the X button (which calls `window.history.back()`), AND a new photo is immediately selected, there's a brief window where two history entries exist for the lightbox.

### BUG 5: Desktop browser back button bypasses `useBlocker` on report forms (LOW-MEDIUM)

**Root cause:** The App.tsx root popstate handler intercepts the browser back button. When `navigationDepth > 0`, it calls `decrementNavigation()` but does NOT call `navigate(-1)` — it lets the browser's native popstate proceed. React Router's `useBlocker` should intercept this, but the depth counter is now out of sync with the actual history stack. On the NEXT back press, the depth may be 0, causing a redirect to `/dashboard` that bypasses the unsaved-changes dialog.

---

## Fix Plan

### 1. Fix tablet detection in `useReportTabHistory` (critical)

**File:** `src/hooks/useReportTabHistory.tsx`

Replace `isMobile()` (user-agent only) with a check that also considers screen width, matching the `useIsMobile()` hook logic. Specifically, treat devices with `window.innerWidth < 1024` OR touch-capable devices as needing tab-back navigation. This covers:
- Phones (< 768px)
- Tablets in portrait (768–1024px)
- Tablets in landscape with touch

```typescript
// Replace: const isMobileDevice = isMobile();
// With a function that checks touch capability + screen width
const isMobileOrTablet = isMobile() || 
  (window.innerWidth < 1024 && navigator.maxTouchPoints > 0);
```

### 2. Prevent depth counter drift from non-router history entries

**File:** `src/App.tsx`

When the root popstate handler fires and neither overlay nor report-tab is active, check if the popped state belongs to a known non-router entry (lightbox, reportTab, lovableGuard) before decrementing. Only decrement for genuine router-level pops.

```typescript
const handlePopState = (event: PopStateEvent) => {
  if (isOverlayActive()) return;
  if (isReportTabActive()) return;
  
  // Don't decrement for non-router history entries
  const state = event.state;
  if (state?.lightbox || state?.reportTab) return;
  
  if (isMobileDevice) triggerNavigationHaptic();
  
  if (state?.lovableGuard && getNavigationDepth() === 0) {
    window.history.pushState({ lovableGuard: true }, "");
    navigate("/dashboard");
  } else if (getNavigationDepth() > 0) {
    decrementNavigation();
  }
};
```

### 3. Guard lightbox popstate handler against stale closures

**File:** `src/components/PhotoGallery.tsx`

Use a ref for `selectedPhotoIndex` in the popstate handler to avoid stale closure issues, and ensure `overlayActive` is cleared synchronously before the handler returns.

### 4. Add viewport resize listener in `useReportTabHistory`

**File:** `src/hooks/useReportTabHistory.tsx`

If the user rotates a tablet from landscape (> 1024) to portrait (< 1024), the hook should dynamically enable/disable tab history tracking. Add a resize listener or use `useIsMobile()` pattern.

---

## Files Changed

1. **`src/hooks/useReportTabHistory.tsx`** — Use touch + screen-width detection instead of UA-only; add resize listener for orientation changes
2. **`src/App.tsx`** — Filter popstate events by state type to prevent depth drift; skip non-router pops
3. **`src/components/PhotoGallery.tsx`** — Use ref for popstate handler to prevent stale closures
4. **`src/components/inspection/ItemPhotoUpload.tsx`** — Same stale-closure fix as PhotoGallery

