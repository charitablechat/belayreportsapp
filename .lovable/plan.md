
# Fix Browser Back Navigation to Use True History

## Problem

Every "back" action in the app is hardcoded to `navigate("/dashboard")`. This means:
- Pressing the back arrow from a report always goes to the dashboard, even if you navigated from another page (e.g., Admin, Profile)
- The browser's native back button and swipe-back gesture on mobile don't match the in-app back button behavior
- On mobile, swiping back on the first tab of a report also hardcodes to `/dashboard`

## Solution

Create a small utility function `goBack` that uses `navigate(-1)` (browser history back) with a fallback to `/dashboard` if there's no prior history entry. Then replace all hardcoded `navigate("/dashboard")` back-button calls with this utility.

**Note:** "Cancel" buttons on creation forms and auth redirects will keep their explicit `navigate("/dashboard")` since those are intentional destination navigations, not "go back" actions.

## Utility: `src/lib/navigation.ts` (new file)

A helper that checks `window.history.length` to determine if there's a real history entry to go back to. If not (e.g., user opened a direct link), it falls back to `/dashboard`.

```ts
export function goBack(navigate: (to: string | number) => void) {
  if (window.history.length > 1) {
    navigate(-1);
  } else {
    navigate("/dashboard");
  }
}
```

## Files Changed

### 1. `src/pages/InspectionForm.tsx`
- **Back button** (line 1924): `navigate("/dashboard")` -> `goBack(navigate)`
- **Swipe-back** (line 151): `navigate('/dashboard')` -> `goBack(navigate)`

### 2. `src/pages/TrainingForm.tsx`
- **Back button** (line 955): `navigate("/dashboard")` -> `goBack(navigate)`
- **Swipe-back** (line 112): `navigate('/dashboard')` -> `goBack(navigate)`

### 3. `src/pages/DailyAssessmentForm.tsx`
- **Back button** (line 1029): `navigate("/dashboard")` -> `goBack(navigate)`
- **Swipe-back** (line 107): `navigate('/dashboard')` -> `goBack(navigate)`

### 4. `src/pages/Profile.tsx`
- **Back button** (line 259): `navigate("/dashboard")` -> `goBack(navigate)`
- The "Cancel" button on the profile form keeps `navigate("/dashboard")` (intentional destination)

### 5. `src/pages/NewInspection.tsx`
- **Back button** (line 232): `navigate("/dashboard")` -> `goBack(navigate)`
- The "Cancel" button keeps `navigate("/dashboard")`

### 6. `src/pages/NewTraining.tsx`
- **Back button** (line 169): `navigate("/dashboard")` -> `goBack(navigate)`
- The "Cancel" button keeps `navigate("/dashboard")`

### 7. `src/pages/NewDailyAssessment.tsx`
- **Back button** (line 178): `navigate("/dashboard")` -> `goBack(navigate)`
- The "Cancel" button keeps `navigate("/dashboard")`

## What Does NOT Change

- Auth redirects (`navigate("/")` on sign-out) -- these are intentional
- "Cancel" buttons on forms -- these intentionally discard and go to dashboard
- Sign-out flows
- No visual/styling changes -- purely navigation logic
- All existing header styling, muted field cards, and category nav bar aesthetics remain untouched

## Summary

- 1 new utility file (`src/lib/navigation.ts`)
- 7 files updated (back buttons + swipe handlers)
- Each change: replace `navigate("/dashboard")` with `goBack(navigate)` on back-arrow buttons only
- Fallback ensures direct-link visitors still land on dashboard instead of exiting the app
