## Dashboard & Reports Background Refresh — Deep Navy Editorial

A focused, purely cosmetic pass on the dashboard's background and card surface treatment. Zero data, sync, or business logic touched.

### Direction
- **Canvas:** Deep navy editorial palette — `#0f172a → #1e293b → #334155` with `#94a3b8` accent.
- **Motion:** A slow, large-radius animated gradient mesh (60s loop, CSS-only, GPU-friendly).
- **Surfaces:** Deep glassmorphism — translucent frosted panels with soft edge glow and diffuse shadows.

### Scope (4 files, cosmetic only)

1. **`src/index.css`** — Add the new background system:
   - `.dashboard-canvas` — fixed full-viewport layer with three radial gradients (navy → slate) animating across a 60s loop. Uses `transform: translate3d` for compositor-only animation; respects `prefers-reduced-motion`.
   - Refine `.glass-panel`, `.glass-surface`, `.glass-report-card` for the darker canvas: increase backdrop-blur to `xl` (20px), lower surface opacity (`bg-white/[0.04]` light / `bg-slate-900/40` dark), add inner highlight border `border-white/[0.08]`, soft diffuse shadow `shadow-[0_8px_32px_rgba(2,6,23,0.35)]`.
   - Add `.glass-card-glow` utility for the subtle 1px top edge highlight that makes glass feel lit.

2. **`src/pages/Dashboard.tsx`** — Background swap only:
   - Replace the `getSessionBackground()` random photo texture with the new `.dashboard-canvas` layer.
   - Keep `background-manager.ts` and all 10 background assets in place (no deletion) so we can revert instantly if desired.
   - Tighten foreground text colors to maintain AA contrast on the darker canvas where needed (headings, muted captions).

3. **`src/components/dashboard/ReportCard.tsx`** — Tint refinement only:
   - Keep the existing age-state border-left accents.
   - Soften age-state background tints for the darker canvas (current `bg-red-500/[0.06]` etc. read too pale on navy — bump to `/[0.10]` and warm the hue slightly).
   - Add `.glass-card-glow` to the card root.

4. **`src/components/dashboard/DashboardStatsBar.tsx`** — Active-state polish:
   - Slightly increase active-state ring/glow so selected filter pops on the darker canvas.

### Out of Scope (intentionally untouched)
- Report output / PDF / HTML viewer styling — reports remain Georgia serif, white paper aesthetic per the Minimal Brutalist memory.
- Form pages (Inspection, Training, Daily, JCF).
- Auth, sync, RLS, edge functions, schema.
- Dialogs, sheets, modals.
- The Foyer action cards (Inspection / Training / Daily) — already glass; will inherit canvas improvements automatically.

### Light/Dark Mode
The deep navy canvas is the default in both modes (it's a brand backdrop, not theme-dependent — like a magazine cover stock). Card glass auto-adapts via existing `dark:` variants. Text on the canvas uses the existing `--foreground` token, which already reads cleanly on this navy.

### Reversibility
- Background swap is a single class change in `Dashboard.tsx` — revertable in one edit.
- All new CSS lives in additive utilities; no existing classes are deleted.
- `background-manager.ts` and the 10 photo backgrounds stay on disk for instant rollback.

### Verification
- Visual QA via preview screenshot after implementation (light + dark, with and without `prefers-reduced-motion`).
- Confirm AA contrast for stat numbers, captions, and inspector names against the new canvas.
- Confirm `COMPLETED` and `INVOICED` watermarks remain legible on the new card tints.

### Technical Details
- Animated gradient uses `background-position` shifts on a single fixed pseudo-element to avoid layout thrash. No JS, no Canvas, no SVG filters.
- `backdrop-filter: blur(20px)` is already widely supported; existing Safari fallback (solid bg) continues to work.
- No new dependencies, no asset additions, no bundle-size impact beyond ~40 lines of CSS.
