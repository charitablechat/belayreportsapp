

## Add Geolocation Button to Active Inspection Reports

### Problem
The Location field in `InspectionHeader.tsx` (used in active/ongoing reports) is a plain text input with no geo button. Users can only get geolocation when creating a new report via `NewInspection.tsx`.

### Solution
Add the same geo button pattern from `NewInspection` into `InspectionHeader`, next to the Location field.

### Changes

**`src/components/inspection/InspectionHeader.tsx`**

1. Import `getCurrentLocationWithAddress`, `getGeolocationErrorMessage` from `@/lib/geolocation`, `triggerHaptic` from `@/lib/haptics`, `MapPin`, `Loader2`, `X` from `lucide-react`, `toast` from `sonner`, and add `useState` import.

2. Replace the plain Location `renderField` call (line 113-115) with a custom layout matching NewInspection:
   - Location text input (VoiceInput, keeping voice support)
   - "Get Location" / "Update" button with MapPin icon
   - Clear (X) button when coordinates exist
   - Loading spinner state while fetching GPS

3. Add local state: `locationLoading` boolean.

4. Add `handleLocationCapture` function that:
   - Calls `getCurrentLocationWithAddress()`
   - Calls `onUpdate("location", position.address)` to set the address
   - Calls `onImmediateSave?.()` to persist
   - Shows success/error toasts

5. The button is disabled when `isReadOnly` is true.

### Files
| File | Change |
|------|--------|
| `src/components/inspection/InspectionHeader.tsx` | Add geo button with loading state next to Location field, matching NewInspection UX |

