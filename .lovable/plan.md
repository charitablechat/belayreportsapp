## BelayReports Palette + Maximum Frosted Glass

A cosmetic-only refresh. No data, sync, RLS, or business-logic changes. The deep-navy canvas from the previous pass is replaced with a light, teal-tinted canvas built from the attached palette, and frosted glass is pushed as far as it can go without hurting legibility.

### Palette (from attachment, wired as HSL design tokens)

| Token | Hex | Use |
|---|---|---|
| `--primary` | `#14B8A6` Primary Teal | Buttons, links, active filters, focus rings |
| `--primary-hover` | `#0F9D8D` | Hover state |
| `--primary-dark` | `#0D3D3D` | Headings, deep accents, dark glass tint |
| `--primary-dark-hover` | `#184646` | Hover on dark surfaces |
| `--accent` | `#A6533B` Accent Orange | Warnings / status highlights |
| `--accent-blue` | `#85B8DB` | Info chips, completed-state tint |
| `--background` | `#F3F4F6` BG Main | Page canvas base |
| `--card` | `#FFFFFF` | Solid card fallback |
| `--card-highlight` | `#EAF9F7` | Glass card tint base |
| `--overlay` | `#474C58` | Dark overlays, lightboxes |
| `--foreground` | `#1E1E21` Text Primary | Body text |
| `--muted-foreground` | `#4D545F` Text Secondary | Captions |
| `--text-muted` | `#747B85` | Disabled, helper text |
| `--border` | `#E5E7EB` Border Light | Default borders |
| `--border-accent` | `#24464B` Border Teal | Active card edges |

All values stored as HSL triples in `src/index.css` per the project's Tailwind token convention. Existing semantic classes (`bg-primary`, `text-foreground`, etc.) inherit automatically — no component rewrites needed for the recolor itself.

### Canvas: Teal Frosted Aurora

Replace `.dashboard-canvas` (currently `#0b1220` navy) with a light teal aurora:

- Base: `#F3F4F6` (BG Main)
- Three radial gradients using Primary Teal, Accent Blue, and BG Card Highlight at low opacity (8–14%) drifting on the existing 60s CSS-only keyframe.
- Subtle teal vignette via `::after`.
- `prefers-reduced-motion` already respected.

### Maximum Glass (scope below)

Goal: every meaningful surface above the canvas reads as frosted glass — translucent fill, `backdrop-filter: blur(16–24px)`, 1px inner top highlight, soft diffused shadow tinted with `--primary-dark` at ~10% alpha.

New / refined utilities in `src/index.css` (additive — none of the old utilities are deleted, just retuned for the lighter canvas):

- `.glass-panel`, `.glass-surface`, `.glass-report-card`, `.glass-stat-button`, `.glass-card-glow` — retuned tints: `bg-white/55` (light) / `bg-[hsl(var(--primary-dark))]/35` (dark), `border-white/40`, `shadow-[0_10px_40px_-12px_hsl(var(--primary-dark)/0.25)]`.
- New `.glass-input` — for inputs, selects, search bar, textareas: `bg-white/45 backdrop-blur-md border-white/50 focus:border-primary/60`.
- New `.glass-chip` — for Badges and small pills.
- New `.glass-header` — slightly stronger blur (24px) + bottom hairline.
- Safari fallback (`@supports not (backdrop-filter: blur(1px))`) drops back to a solid `--card` fill so nothing becomes unreadable.

### Files changed (cosmetic only)

1. **`src/index.css`** — Recolor every HSL token (light + dark blocks) to the new palette, retune `.dashboard-canvas` to teal aurora, add `.glass-input` / `.glass-chip` / `.glass-header`, retune existing glass utilities for the lighter canvas. ~120 lines touched, additive where possible.
2. **`tailwind.config.ts`** — Add `primary-dark`, `primary-dark-hover`, `accent-blue`, `card-highlight`, `border-accent` to the `colors` map so utility classes resolve. No removals.
3. **`src/components/AuthenticatedHeader.tsx`** — Swap header background class to `.glass-header` (currently a custom glass mix; this aligns it with the new system).
4. **`src/components/dashboard/ReportCard.tsx`** — Re-warm age-state tints for the lighter canvas: `bg-red-500/[0.08]` / `bg-amber-400/[0.10]` / `bg-sky-400/[0.10]` (the new Accent Blue maps to "completed"); keep `.glass-card-glow`.
5. **`src/components/dashboard/DashboardStatsBar.tsx`** — Active-state ring switches to `ring-primary/40` with teal-tinted glow shadow.
6. **`src/components/dashboard/DashboardSearchBar.tsx`** — Add `.glass-input` to the `<Input>` so the search bar reads as glass.
7. **`src/pages/Dashboard.tsx`** — Section wrappers (filters bar, foyer cards area, recent-reports container) get `.glass-panel` where they currently use plain backgrounds. No layout changes.
8. **`src/components/ui/dialog.tsx`, `sheet.tsx`, `dropdown-menu.tsx`, `popover.tsx`** — Add `.glass-panel` to the Content variant so modals/sheets/menus inherit frosted glass globally. This is the lever that delivers "as much glass as possible" without touching individual call sites.

### Out of scope (intentionally untouched)

- Report HTML/PDF output — stays Georgia serif, white paper aesthetic, per the Minimal Brutalist memory.
- Form pages (Inspection, Training, Daily, JCF) — input recolor only via token inheritance; no layout/glass push on form bodies (they need maximum contrast for data entry).
- Auth flows, RLS, edge functions, sync, schema, dialogs' behavior.
- The 10 background photo assets and `background-manager.ts` stay on disk for fast rollback.

### Light / dark mode

Both modes get the new palette. Dark mode uses `--primary-dark` (`#0D3D3D`) as the canvas base with the same teal aurora at lower alpha. Glass utilities auto-adapt via `dark:` variants. AA contrast verified for `--foreground` on both canvases and for badge/stat text on glass surfaces.

### Verification

- Visual QA via preview screenshot — dashboard, recent reports, dialog open, dropdown open, sheet open, in light + dark.
- AA contrast spot-check: stat numbers, captions, inspector names, badge text, INVOICED/COMPLETED watermarks.
- Confirm `prefers-reduced-motion` pins the canvas gradient.
- Confirm Safari fallback renders solid cards (no transparent text).

### Reversibility

- Single commit, tokens-first. Reverting `src/index.css` restores prior look.
- No component logic, no asset deletions, no dependency changes.
- `.dashboard-canvas` swap is a one-liner if we ever want to A/B navy vs. teal.

### Technical notes

- All colors stored as HSL triples (`H S% L%`) in `:root` and `.dark`, matching existing Tailwind v3 token wiring. No raw hex inside components.
- `backdrop-filter: blur(20px)` is GPU-composited; no JS, no SVG filters, no new dependencies. Bundle size delta ≈ +60 lines of CSS.
- The dialog/sheet/menu glass push is opt-in via a class on the shared `Content` component — easy to revert per primitive if any specific dialog needs solid bg.
