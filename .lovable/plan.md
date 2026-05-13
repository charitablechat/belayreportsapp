Plan:

1. Replace the static Sync Terminal category headers with real full-width disclosure buttons.
   - Pending reports
   - Pending photos
   - Stuck validation
   - Held back
   - Quarantined
   - Failed photos
   - Orphan records
   - Temp-parent photos
   - Self-check
   - Diagnostic

2. Use controlled React state for each category instead of relying on visual caret text only.
   - Headers will use `aria-expanded`.
   - The entire header row will be tappable, not just a tiny caret or right-side control.
   - Keep existing action buttons like Retry/Fix/Reassign/Delete working without accidentally toggling their parent section.

3. Make mobile/iPad touch behavior robust.
   - Add larger tap targets and `touch-action: manipulation` on disclosure headers.
   - Avoid nested clickable areas where a child button steals or blocks the expand tap.
   - Keep the sheet scrollable while preventing taps from being interpreted as drag/scroll gestures.

4. Default-open the important problem categories so users immediately see actionable stuck items.
   - Categories with blocking/actionable issues open by default when the sheet opens.
   - Users can collapse them afterward.

5. Verify the implementation by checking the updated component structure and, if possible, testing the mobile-width preview interaction for category expansion.