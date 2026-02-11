

# Full-Page Dashboard Background Image

## Change

Currently the background image is confined to `h-[45vh] md:h-[50vh]` at the top. This will be changed to cover the entire page, sitting behind all content including report cards and known issues.

## Details

In `src/pages/Dashboard.tsx`, update the background container:

| Property | Before | After |
|----------|--------|-------|
| Container height | `h-[45vh] md:h-[50vh]` | `h-full min-h-screen` |
| Container positioning | `absolute inset-x-0 top-0` | `fixed inset-0` (stays behind on scroll) |
| Object position | `object-[center_70%]` | `object-center` (natural center) |
| Gradient overlay | `from-slate-900/50 via-transparent to-background` | `from-slate-900/50 via-background/60 to-background/80` (ensures text readability over the full page) |

Using `fixed inset-0` means the image fills the viewport and stays in place as the user scrolls, creating a parallax-like effect where content scrolls over the background. The gradient is adjusted to keep text and cards legible over the image without fully hiding it.

## File

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Update background container from partial-height to full-viewport fixed background with adjusted gradient for readability |

