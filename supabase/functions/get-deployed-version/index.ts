/**
 * Returns the deployed production version by fetching rwreports.com/version.json
 * server-side and re-emitting it with permissive CORS headers.
 *
 * Why this exists: the Lovable preview iframe is served from a different
 * origin than rwreports.com / belayreports.com, and neither production
 * origin sends Access-Control-Allow-Origin on /version.json. So a direct
 * cross-origin fetch from the preview is blocked. This tiny proxy lets the
 * preview's VersionBadge show the real deployed version (e.g. v4.8.1)
 * instead of the always-stale local bundle version (e.g. v4.8.0).
 *
 * Public, idempotent, no secrets, no DB access. Rate-limited per IP.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  checkRateLimit,
  getClientIP,
  createRateLimitResponse,
} from "../_shared/rate-limiter.ts";

const PROBE_URL = "https://rwreports.com/version.json";
const UPSTREAM_TIMEOUT_MS = 4000;
const RATE_LIMIT_CONFIG = { maxRequests: 60, windowMs: 60 * 1000 };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ip = getClientIP(req);
    const rl = checkRateLimit(`get-deployed-version:${ip}`, RATE_LIMIT_CONFIG);
    if (!rl.allowed) {
      return createRateLimitResponse(rl.resetAt, corsHeaders);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let body: { version: string | null; build: string | null } = {
      version: null,
      build: null,
    };
    try {
      const res = await fetch(`${PROBE_URL}?t=${Date.now()}`, {
        signal: controller.signal,
        headers: { "Cache-Control": "no-cache" },
      });
      if (res.ok) {
        const data = await res.json();
        body = {
          version: typeof data?.version === "string" ? data.version : null,
          build: typeof data?.build === "string" ? data.build : null,
        };
      }
    } catch {
      // swallow — caller treats null as "unknown" and falls back to local
    } finally {
      clearTimeout(timer);
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("get-deployed-version error:", err);
    return new Response(
      JSON.stringify({ version: null, build: null }),
      {
        status: 200, // soft-fail: badge falls back silently
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
