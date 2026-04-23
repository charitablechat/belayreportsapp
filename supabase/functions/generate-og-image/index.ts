import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import React from "https://esm.sh/react@18.2.0";
import { ImageResponse } from "https://deno.land/x/og_edge@0.0.6/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";

import { corsHeaders } from "../_shared/cors.ts";
type ReportType = "inspection" | "training" | "daily_assessment";

interface ReportMeta {
  organization: string;
  date: string;
  location: string;
  status: string;
  equipmentCount?: number;
  type: ReportType;
}

const TYPE_LABELS: Record<ReportType, string> = {
  inspection: "INSPECTION",
  training: "TRAINING",
  daily_assessment: "DAILY ASSESSMENT",
};

function sc(s: string): string { return s === "completed" ? "#00ff41" : s === "draft" ? "#ffb300" : "#888"; }
function sl(s: string): string { return s === "completed" ? "VERIFIED" : s === "draft" ? "DRAFT" : "ARCHIVED"; }

const e = React.createElement;

function buildImage(meta: ReportMeta | null, width: number, height: number) {
  if (!meta) {
    return new ImageResponse(
      e("div", { style: { width: "100%", height: "100%", backgroundColor: "#0a0a0a", display: "flex", justifyContent: "center", alignItems: "center", fontFamily: "monospace", color: "#ff4444", fontSize: 24 } }, "Report Not Found"),
      { width, height }
    );
  }

  const statusColor = sc(meta.status);
  const statusLabel = sl(meta.status);
  const typeLabel = TYPE_LABELS[meta.type] || meta.type.toUpperCase();
  const org = meta.organization.length > 32 ? meta.organization.substring(0, 32) + "…" : meta.organization;
  const loc = meta.location.length > 24 ? meta.location.substring(0, 24) + "…" : meta.location;

  return new ImageResponse(
    e("div", { style: { width: "100%", height: "100%", backgroundColor: "#0a0a0a", display: "flex", flexDirection: "column", fontFamily: "monospace", color: "#e0e0e0", position: "relative" } },
      // CRT scanlines
      e("div", { style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)", display: "flex" } }),
      // Bento grid
      e("div", { style: { display: "flex", flex: 1, padding: 40, gap: 20 } },
        // Left cell
        e("div", { style: { display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", border: "1px solid #333", borderRadius: 12, padding: 24, width: 260, gap: 16 } },
          e("div", { style: { fontSize: 14, color: "#00ff41", letterSpacing: 3, display: "flex" } }, typeLabel),
          e("div", { style: { fontSize: 11, color: "#555", border: "1px solid #333", borderRadius: 6, padding: "4px 12px", display: "flex" } }, "v2.9.3"),
          e("div", { style: { fontSize: 11, color: "#444", display: "flex" } }, "REPORT"),
        ),
        // Center cell
        e("div", { style: { display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, border: "1px solid #333", borderRadius: 12, padding: 32, gap: 16 } },
          e("div", { style: { fontSize: 28, fontWeight: 700, color: "#fff", display: "flex" } }, org),
          e("div", { style: { display: "flex", gap: 20, fontSize: 14, color: "#888" } },
            e("span", null, meta.date),
            e("span", { style: { color: "#333" } }, "│"),
            e("span", null, loc),
          ),
          meta.equipmentCount && meta.equipmentCount > 0
            ? e("div", { style: { fontSize: 12, color: "#555", display: "flex" } }, `${meta.equipmentCount} equipment items inspected`)
            : null,
        ),
        // Right cell
        e("div", { style: { display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", border: "1px solid #333", borderRadius: 12, padding: 24, width: 180, gap: 12 } },
          e("div", { style: { width: 16, height: 16, borderRadius: "50%", backgroundColor: statusColor, boxShadow: `0 0 12px ${statusColor}`, display: "flex" } }),
          e("div", { style: { fontSize: 14, color: statusColor, letterSpacing: 2, fontWeight: 700, display: "flex" } }, statusLabel),
        ),
      ),
      // Bottom branding
      e("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 40px", borderTop: "1px solid #1a1a1a" } },
        e("div", { style: { fontSize: 12, color: "#444", letterSpacing: 1, display: "flex" } }, "ROPE WORKS DIGITAL INSPECTION PLATFORM"),
        e("div", { style: { fontSize: 11, color: "#333", display: "flex" } }, "ropeworks.lovable.app"),
      ),
    ),
    { width, height, headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } }
  );
}

async function fetchMeta(supabase: ReturnType<typeof createClient>, type: ReportType, hash: string): Promise<ReportMeta | null> {
  const p = `${hash}%`;
  if (type === "inspection") {
    const { data } = await supabase.from("inspections").select("id, organization, inspection_date, location, status").is("deleted_at", null).like("id", p).limit(1).single();
    if (!data) return null;
    const { count } = await supabase.from("inspection_equipment").select("id", { count: "exact", head: true }).eq("inspection_id", data.id);
    return { organization: data.organization || "Unknown", date: data.inspection_date || "N/A", location: data.location || "N/A", status: data.status || "draft", equipmentCount: count || 0, type: "inspection" };
  }
  if (type === "training") {
    const { data } = await supabase.from("trainings").select("organization, start_date, site, status").is("deleted_at", null).like("id", p).limit(1).single();
    if (!data) return null;
    return { organization: data.organization || "Unknown", date: data.start_date || "N/A", location: data.site || "N/A", status: data.status || "draft", type: "training" };
  }
  if (type === "daily_assessment") {
    const { data } = await supabase.from("daily_assessments").select("organization, assessment_date, site, status").is("deleted_at", null).like("id", p).limit(1).single();
    if (!data) return null;
    return { organization: data.organization || "Unknown", date: data.assessment_date || "N/A", location: data.site || "N/A", status: data.status || "draft", type: "daily_assessment" };
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIP = getClientIP(req);
  const rc = checkRateLimit(`og-image:${clientIP}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rc.allowed) return createRateLimitResponse(rc.resetAt, corsHeaders);

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") as ReportType | null;
    const id = url.searchParams.get("id");
    const size = url.searchParams.get("size") || "og";

    if (!type || !["inspection", "training", "daily_assessment"].includes(type)) {
      return new Response("Missing or invalid 'type'", { status: 400, headers: corsHeaders });
    }
    if (!id || !/^[a-f0-9]{8}$/i.test(id)) {
      return new Response("Missing or invalid 'id'", { status: 400, headers: corsHeaders });
    }

    const w = 1200;
    const h = size === "twitter" ? 600 : 630;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const meta = await fetchMeta(supabase, type, id);
    return buildImage(meta, w, h);
  } catch (error) {
    console.error("[generate-og-image] Error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate image" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
