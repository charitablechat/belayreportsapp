import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";

import { corsHeaders } from "../_shared/cors.ts";
import { getSiteUrl } from "../_shared/site-url.ts";
type ReportType = "inspection" | "training" | "daily_assessment";

const TYPE_LABELS: Record<ReportType, string> = {
  inspection: "Inspection Report",
  training: "Training Report",
  daily_assessment: "Daily Assessment",
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIP = getClientIP(req);
  const rc = checkRateLimit(`og-meta:${clientIP}`, { maxRequests: 60, windowMs: 60_000 });
  if (!rc.allowed) return createRateLimitResponse(rc.resetAt, corsHeaders);

  const url = new URL(req.url);
  const type = url.searchParams.get("type") as ReportType | null;
  const id = url.searchParams.get("id");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const functionsBaseUrl = `${supabaseUrl}/functions/v1`;
  const spaBaseUrl = getSiteUrl();

  if (!type || !["inspection", "training", "daily_assessment"].includes(type) ||
      !id || !/^[a-f0-9]{8}$/i.test(id)) {
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title><meta http-equiv="refresh" content="2;url=${spaBaseUrl}"></head><body style="background:#0a0a0a;color:#ff4444;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Report not found. Redirecting…</p></body></html>`,
      { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  try {
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const hashPattern = `${id}%`;

    let org = "Unknown";
    let date = "";
    let location = "";
    let status = "draft";

    if (type === "inspection") {
      const { data } = await supabase.from("inspections")
        .select("organization, inspection_date, location, status")
        .is("deleted_at", null).like("id", hashPattern).limit(1).single();
      if (!data) throw new Error("Not found");
      org = data.organization || org;
      date = data.inspection_date || "";
      location = data.location || "";
      status = data.status || "draft";
    } else if (type === "training") {
      const { data } = await supabase.from("trainings")
        .select("organization, start_date, site, status")
        .is("deleted_at", null).like("id", hashPattern).limit(1).single();
      if (!data) throw new Error("Not found");
      org = data.organization || org;
      date = data.start_date || "";
      location = data.site || "";
      status = data.status || "draft";
    } else if (type === "daily_assessment") {
      const { data } = await supabase.from("daily_assessments")
        .select("organization, assessment_date, site, status")
        .is("deleted_at", null).like("id", hashPattern).limit(1).single();
      if (!data) throw new Error("Not found");
      org = data.organization || org;
      date = data.assessment_date || "";
      location = data.site || "";
      status = data.status || "draft";
    }

    // Only expose organization/location/date for completed (published) reports.
    // Draft/archived reports return generic copy to avoid leaking private metadata
    // about unfinished or withdrawn work to anyone who guesses an 8-char ID prefix.
    const isPublic = status === "completed";
    const statusLabel = isPublic ? "Verified" : status === "draft" ? "Draft" : "Archived";
    const typeLabel = TYPE_LABELS[type];
    const desc = isPublic
      ? [date, location, statusLabel].filter(Boolean).join(" | ")
      : `${statusLabel} ${typeLabel}`;
    const title = isPublic ? `${typeLabel} — ${org}` : `${typeLabel} — Belay Reports`;


    const ogImageUrl = `${functionsBaseUrl}/generate-og-image?type=${type}&id=${id}&size=og`;
    const twitterImageUrl = `${functionsBaseUrl}/generate-og-image?type=${type}&id=${id}&size=twitter`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Belay Reports" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(desc)}" />
  <meta name="twitter:image" content="${escapeHtml(twitterImageUrl)}" />
  <meta http-equiv="refresh" content="0;url=${spaBaseUrl}/dashboard" />
</head>
<body style="background:#0a0a0a;color:#e0e0e0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <p>Redirecting to <a href="${spaBaseUrl}/dashboard" style="color:#00ff41">Belay Reports</a>…</p>
</body>
</html>`;

    return new Response(html, {
      headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  } catch (error) {
    console.error("[og-meta] Error:", error);
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title><meta http-equiv="refresh" content="2;url=${spaBaseUrl}"></head><body style="background:#0a0a0a;color:#ff4444;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Report not found. Redirecting…</p></body></html>`,
      { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
    );
  }
});
