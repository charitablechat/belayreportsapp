

## Make Section Notes Text Black

### Change
Update the text color in the Section Notes from amber/brown to black in both:

1. **Form UI** (`SectionComments.tsx` line 33): Change `text-amber-900` to `text-black` (keep `dark:text-amber-100` for dark mode)
2. **Report HTML** (`generate-daily-assessment-html/index.ts` line 529): Change `color: #78350f` to `color: #000000`

Two lines changed, purely cosmetic.

