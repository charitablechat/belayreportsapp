

## Auto-populate location on new report creation

### What already exists
- `getCurrentLocationWithAddress()` in `src/lib/geolocation.ts` — returns "City, State" (or town/municipality/village/hamlet/county fallback). Never returns raw coordinates unless reverse geocoding fails entirely.
- Manual MapPin buttons on `NewInspection`, `NewTraining`, `NewDailyAssessment`, and inside the report headers.
- Permission/error handling already wired with toast feedback.

### What's missing
No code path *automatically* calls it when the "New Report" page mounts. The user has to tap the MapPin button.

### Plan

Add a one-shot auto-capture on mount in the three "New" pages:

1. **`src/pages/NewInspection.tsx`** — add a `useEffect` that runs once on mount:
   - Skip if `formData.location` is already set (e.g. user came back via swipe).
   - Skip if `navigator.permissions.query({name:'geolocation'})` reports `'denied'` (avoid spamming a denied prompt).
   - Otherwise call `handleLocationCapture()` silently — same function already in the file, just suppress the success toast on auto runs (add an `auto` flag) and downgrade errors to a quiet `console.warn` (no toast) so a denied prompt doesn't feel intrusive.
2. **`src/pages/NewTraining.tsx`** — same pattern.
3. **`src/pages/NewDailyAssessment.tsx`** — same pattern.

### UX details
- **Permission**: the browser still shows its native permission prompt the first time. That's required by every browser — there's no way around it. After the first grant/deny, subsequent runs are silent.
- **Offline**: `getCurrentLocation()` works offline (GPS), but `reverseGeocode` needs internet. If reverse geocoding fails, the helper falls back to coordinates — but per the user's requirement "not coordinates", we'll change the auto-path to leave the field **empty** on reverse-geocode failure rather than write coordinates. The manual MapPin button keeps its existing fallback (so a user who explicitly taps it still gets *something*).
- **Loading indicator**: existing `locationLoading` spinner on the MapPin button covers the auto-run too.
- **Permission denied**: silent — no toast, field stays empty, user can still type or tap MapPin manually.
- **Editing existing report**: no change. Auto-fill only fires on the "New" pages, not on `InspectionForm`/`TrainingForm`/`DailyAssessmentForm` editing routes. Existing reports keep whatever they had.

### Small refactor
Add an optional `silent?: boolean` parameter to each page's `handleLocationCapture` so the auto-run can suppress success toast + error toast while still showing the spinner. Manual MapPin clicks pass `silent: false` (default) and keep current loud feedback.

### Files
- EDIT: `src/pages/NewInspection.tsx` (~15 lines: useEffect + silent flag)
- EDIT: `src/pages/NewTraining.tsx` (~15 lines)
- EDIT: `src/pages/NewDailyAssessment.tsx` (~15 lines)

No new files, no hook changes, no DB changes, no edge functions.

### Risk
- Native permission prompt on first visit (one-time, expected, can't be avoided cross-platform).
- Nominatim is rate-limited (1 req/sec free tier) — auto-fire on report creation is well under that for a single user. Already in use today via the manual button, no change in volume pattern.
- iOS Safari requires HTTPS for geolocation — already satisfied on rwreports.com / ropeworks.lovable.app.

