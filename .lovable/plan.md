

# Back Button + Logo Navigation Overhaul

## Current State

**Back button behavior** is inconsistent across the app:
- Some pages use `goBack(navigate)` which correctly does `navigate(-1)` when history exists, falling back to `/dashboard` -- this is the RIGHT pattern (NewInspection, NewTraining, NewDailyAssessment, Profile, form save-and-leave dialogs)
- Some pages hardcode `navigate('/dashboard')` instead of using `goBack()` -- these skip history and always jump to dashboard (SuperAdminDashboard, Install, Capabilities, InspectionForm loading state)

**Logo behavior**: The Rope Works logo appears on multiple pages (Dashboard, NewInspection, NewTraining, NewDailyAssessment, Capabilities, AuroraLanding) but is **never clickable** -- it's always a plain `<img>` tag.

---

## Changes

### 1. Update `goBack()` to always use history navigation

The current `goBack()` in `src/lib/navigation.ts` already prefers `navigate(-1)` when depth > 0. The function is correct as-is -- no changes needed to the core logic. The fix is getting all pages to **use it**.

### 2. Convert hardcoded `navigate('/dashboard')` back buttons to `goBack()`

| Page | Current | Change |
|------|---------|--------|
| `SuperAdminDashboard.tsx` (line 591) | `navigate('/dashboard')` | `goBack(navigate)` |
| `Install.tsx` (line 27) | `navigate('/dashboard')` | `goBack(navigate)` |
| `Capabilities.tsx` (line 193) | `navigate('/dashboard')` | `goBack(navigate)` |
| `InspectionForm.tsx` (line 2099, loading state) | `navigate('/dashboard')` | `goBack(navigate)` |

Each file will add `import { goBack } from "@/lib/navigation"` where missing.

### 3. Make all Rope Works logos clickable (navigate to `/dashboard`)

Wrap every `ropeWorksLogo` `<img>` with a clickable element that navigates to `/dashboard`. This applies to:

| Page | Description |
|------|-------------|
| `Dashboard.tsx` (line 996) | Main dashboard header logo -- already on dashboard, but make it a consistent clickable anchor for reload/scroll-to-top |
| `NewInspection.tsx` (line 245) | Header logo |
| `NewTraining.tsx` (line 179) | Header logo |
| `NewDailyAssessment.tsx` (line 190) | Header logo |
| `Capabilities.tsx` (line 190) | Header logo |
| `AuroraLanding.tsx` (line 40) | Landing page logo |

Each logo gets wrapped with a `<button>` or styled click handler using `onClick={() => navigate('/dashboard')}` with `cursor-pointer` styling. No `<a>` tags to avoid full page reloads -- this is a SPA.

### 4. Glassmorphism alignment

All interactive logo elements will use subtle hover feedback consistent with the existing frosted-glass aesthetic:
- `hover:opacity-80 transition-opacity cursor-pointer` on logo wrappers
- No new borders or shadows -- keep it minimal and aligned with `border-white/20` surfaces

---

## Technical Details

**Files modified (7 total):**

1. **`src/pages/SuperAdminDashboard.tsx`** -- Add `goBack` import, replace `navigate('/dashboard')` with `goBack(navigate)`
2. **`src/pages/Install.tsx`** -- Add `goBack` import, replace `navigate('/dashboard')` with `goBack(navigate)`
3. **`src/pages/Capabilities.tsx`** -- Replace `navigate('/dashboard')` with `goBack(navigate)` on back button
4. **`src/pages/InspectionForm.tsx`** -- Replace `navigate('/dashboard')` in loading fallback with `goBack(navigate)`
5. **`src/pages/Dashboard.tsx`** -- Wrap logo img with clickable element navigating to `/dashboard`
6. **`src/pages/NewInspection.tsx`** -- Wrap logo with `onClick={() => navigate('/dashboard')}`
7. **`src/pages/NewTraining.tsx`** -- Wrap logo with `onClick={() => navigate('/dashboard')}`
8. **`src/pages/NewDailyAssessment.tsx`** -- Wrap logo with `onClick={() => navigate('/dashboard')}`
9. **`src/pages/Capabilities.tsx`** -- Wrap logo with `onClick={() => navigate('/dashboard')}`
10. **`src/pages/AuroraLanding.tsx`** -- Wrap logo with `onClick={() => navigate('/dashboard')}`

No new components or dependencies. No backend changes.

