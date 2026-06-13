On the sign-in page, the marble GIF background is cropped by `object-cover`. To show the full GIF (including the "Belay Reports" text within it), switch the background `<img>` from `object-cover` to `object-contain`.

Scope
- File: `src/components/Auth.tsx`
- Change: `className="w-full h-full object-cover"` → `className="w-full h-full object-contain"`
- Result: Entire marble GIF scales to fit the viewport without cropping (letter/pillarboxing acceptable).