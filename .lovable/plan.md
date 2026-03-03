

## Dynamic OG Image Generation with Retro-Tech Terminal Aesthetic

### Overview

Create a backend function that dynamically generates OpenGraph and Twitter Card images for inspection/training/assessment reports. The images use a retro-tech terminal aesthetic with CRT scanlines, monospaced typography, and a bento grid layout. A companion edge function serves the correct `<meta>` tags for social crawlers.

### Architecture

Since this is a single-page application, social crawlers (Twitter, Facebook, Slack) cannot execute JavaScript to read dynamic `<meta>` tags. The solution requires:

1. **Edge function `generate-og-image`** -- Renders an SVG-based OG image using `satori` (runs natively in Deno), converts to PNG via `resvg-wasm`, and returns the image binary.
2. **Edge function `og-meta`** -- Returns an HTML page with proper `<meta>` tags when a social crawler hits a shareable report URL. This acts as a lightweight server-rendered page that redirects real users to the SPA.
3. **Client-side share helper** -- Constructs the shareable URL pointing to the `og-meta` function.

```text
Social Crawler                         User Browser
     |                                      |
     |-- GET /og-meta?type=inspection       |
     |        &id=<short_hash>              |
     |                                      |
     v                                      |
  og-meta edge function                     |
     |-- fetches report metadata            |
     |-- returns HTML with <meta> tags      |
     |   og:image -> generate-og-image URL  |
     |   <meta refresh> -> SPA URL          |
     |                                      |
     v                                      v
  generate-og-image edge function       SPA loads normally
     |-- fetches report data
     |-- renders SVG via satori
     |-- converts to PNG via resvg
     |-- returns 1200x630 PNG
```

### File 1: `supabase/functions/generate-og-image/index.ts`

**Purpose:** Generate a 1200x630 PNG image dynamically.

**Key details:**
- Uses `satori` (npm) to render a React-like JSX tree to SVG
- Uses `@resvg/resvg-wasm` to convert SVG to PNG
- Accepts query params: `type` (inspection/training/assessment), `id` (public short hash, NOT raw UUID), `size` (og/twitter)
- Fetches report metadata from database using service role key (server-side only)
- Filters out soft-deleted records (`deleted_at IS NULL`)
- Returns appropriate error image if record not found or deleted
- Caches via `Cache-Control` headers (1 hour)

**Visual design (Retro-Tech Terminal):**
- Background: dark charcoal (#0a0a0a) with subtle CRT scanline overlay (horizontal lines at 2px intervals, 5% opacity)
- Bento grid: 3-column layout with rounded cells having 1px border (#333)
- Left cell: Report type badge + version badge "v2.5.6"
- Center cell: Organization name, date, location in monospace
- Right cell: Status indicator (Verified/Draft/Archived) with glowing dot
- Bottom strip: "Rope Works Digital Inspection Platform" branding
- Typography: monospace system fonts (Courier New, monospace)
- Accent color: electric green (#00ff41) for terminal feel
- Monochrome palette with green/amber highlights

**Security:**
- Only expose a short hash derived from the UUID (first 8 chars), not the full UUID
- Validate the hash server-side by querying with `id::text LIKE hash%`
- No sensitive data in the image (no internal IDs, no inspector names, no PII)
- Only show: report type, organization, date, status, equipment count

### File 2: `supabase/functions/og-meta/index.ts`

**Purpose:** Serve HTML with proper `<meta>` tags for social crawlers.

**Key details:**
- Accepts same query params as generate-og-image
- Fetches minimal report metadata (organization, date, type, status)
- Filters soft-deleted records
- Returns HTML document with:
  - `og:title` = "Inspection Report - [Organization]"
  - `og:description` = "[Date] | [Location] | [Status]"
  - `og:image` = URL to generate-og-image function
  - `og:image:width` = 1200, `og:image:height` = 630
  - `twitter:card` = "summary_large_image"
  - `twitter:image` = URL to generate-og-image with size=twitter (1200x600)
  - `<meta http-equiv="refresh">` to redirect real users to the SPA
- `verify_jwt = false` (must be publicly accessible for crawlers)

### File 3: `src/lib/og-share.ts`

**Purpose:** Client-side utility to construct shareable URLs.

**Key details:**
- `getShareableUrl(reportType, reportId)` -- returns URL to the og-meta edge function with the short hash
- `getOgImageUrl(reportType, reportId, size)` -- returns direct URL to the OG image
- Short hash: `reportId.replace(/-/g, '').substring(0, 8)` (8 hex chars from UUID)
- Used by the existing share/email flows in `HtmlReportViewer`

### File 4: `supabase/config.toml` updates

Add entries for both new functions with `verify_jwt = false` (crawlers can't authenticate):

```toml
[functions.generate-og-image]
verify_jwt = false

[functions.og-meta]
verify_jwt = false
```

### File 5: Update `src/components/HtmlReportViewer.tsx`

- Add a "Copy Share Link" button that copies the og-meta URL to clipboard
- This gives users a link that shows a rich preview when pasted into Twitter/Slack/etc.

### Security Considerations

| Risk | Mitigation |
|------|-----------|
| UUID exposure | Use 8-char prefix hash, not full UUID |
| Soft-deleted reports | Both functions check `deleted_at IS NULL` |
| PII in image | Only org name, date, status shown -- no inspector names |
| Rate limiting | Use existing `rate-limiter.ts` shared module |
| Service role key | Only used server-side in edge functions, never exposed to client |

### Dependencies

- `satori` -- JSX to SVG renderer (works in Deno via npm: specifier)
- `@resvg/resvg-wasm` -- SVG to PNG converter (WASM-based, works in Deno)
- Both imported via `npm:` or `esm.sh` in the edge function

### Technical Notes

- Image generation is CPU-intensive; edge function timeout (default 60s) is sufficient for a single image
- The 8-char hash provides 4 billion possible values -- sufficient for collision avoidance in this use case
- CRT scanline effect is rendered as semi-transparent horizontal lines in the SVG, not as a separate overlay image
- Font embedding: satori requires font data as ArrayBuffer; we'll embed a subset of a monospace font (e.g., JetBrains Mono from Google Fonts CDN) fetched at runtime and cached

