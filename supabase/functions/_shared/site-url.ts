// Shared resolver for the SPA base URL that edge functions embed into
// outgoing user-facing links (password-reset emails, OG meta redirects,
// etc.). Prefers the `SITE_URL` runtime secret; falls back to the known
// production host so we never emit a link pointing at the raw Supabase
// project slug (e.g. "ssgzcgvygnsrqalisshx.lovable.app") — that URL does
// not resolve and the user's reset email becomes a dead link.
//
// Callers should treat the return value as opaque (no trailing slash,
// scheme included). Pass through to Supabase as `redirectTo` or embed
// directly into HTML/JSON response bodies.
const PRODUCTION_FALLBACK = "https://belayreports.com";

let warnedOnce = false;

export function getSiteUrl(): string {
  const configured = Deno.env.get("SITE_URL");
  if (configured && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, "");
  }
  if (!warnedOnce) {
    warnedOnce = true;
    console.warn(
      "[site-url] SITE_URL env var not set; falling back to " +
        PRODUCTION_FALLBACK +
        ". Set SITE_URL as a Supabase Edge Functions secret to silence this warning.",
    );
  }
  return PRODUCTION_FALLBACK;
}
