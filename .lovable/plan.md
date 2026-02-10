

# Move Dashboard Background Image Lower

## What Changes

Adjust the background image positioning so the skier's head appears just below the Valentine's Day banner instead of being partially hidden behind it.

## Technical Detail

In `src/pages/Dashboard.tsx` (line 837), change the image's CSS `object-position` from `object-center` to `object-[center_30%]`. This shifts the visible "window" of the image downward, pulling the skier's head into view below the banner.

If `30%` isn't quite right, this value can be fine-tuned (higher % = more of the top of the image visible, pushing content down).

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Line 837: `object-center` to `object-[center_30%]` |

