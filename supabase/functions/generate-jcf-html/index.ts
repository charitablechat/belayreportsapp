// Generate Job Completion Form (JCF) HTML report.
// Belay Reports branding · Georgia serif · no page numbers · signed URLs for photos.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getLogoBase64,
  buildAdminEditBanner,
  buildAttestationBlock,
  buildVersionFooter,
  fetchPostCompletionEdits,
} from "../_shared/report-layout.ts";

const SIGNED_URL_EXPIRY = 3600; // 1 hour per spec

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(s: string | null | undefined): string {
  if (!s) return "";
  return escapeHtml(s).replace(/\n/g, "<br>");
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  const dateOnly = String(dateStr).split("T")[0];
  const parts = dateOnly.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts.map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      return `${months[m - 1]} ${d}, ${y}`;
    }
  }
  return dateStr;
}

function yesNo(v: any): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return "—";
}

function checkbox(label: string, v: any): string {
  const mark = v ? "☑" : "☐";
  return `<span style="display:inline-block; margin-right:18px; white-space:nowrap;">${mark} ${escapeHtml(label)}</span>`;
}

function section(title: string, body: string): string {
  return `
    <section style="margin: 22px 0; page-break-inside: avoid;">
      <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 14pt; color:#1B6DB5; margin: 0 0 8px 0; border-bottom: 1px solid #1B6DB5; padding-bottom: 4px;">${escapeHtml(title)}</h2>
      <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.55; color:#0f172a;">
        ${body}
      </div>
    </section>
  `;
}

function freeText(label: string, value: string | null | undefined): string {
  const v = (value ?? "").toString().trim();
  return `
    <div style="margin: 8px 0 14px 0;">
      <div style="font-weight: bold; color:#1e40af; font-size: 10.5pt; margin-bottom: 4px;">${escapeHtml(label)}</div>
      <div>${v ? nl2br(v) : '<span style="color:#94a3b8;">—</span>'}</div>
    </div>
  `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isServiceRole = token === supabaseKey;
    let callerUserId: string | null = null;
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerUserId = user.id;
    }

    const { jcfId, forceRegenerate } = await req.json();
    if (!jcfId) throw new Error("jcfId is required");

    console.log(`[generate-jcf-html] Generating HTML for JCF ${jcfId}`);

    const [logos, jcfResult] = await Promise.all([
      getLogoBase64(),
      supabase
        .from("jcf_reports")
        .select(`
          *,
          profiles!jcf_reports_inspector_id_fkey (
            first_name, last_name, acct_number
          )
        `)
        .eq("id", jcfId)
        .single(),
    ]);

    const { data: jcf, error: jcfError } = jcfResult as any;
    if (jcfError) throw jcfError;
    if (!jcf) throw new Error("JCF report not found");

    // Ownership/role check
    if (!isServiceRole && callerUserId && jcf.inspector_id !== callerUserId) {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", callerUserId)
        .in("role", ["admin", "super_admin"])
        .maybeSingle();
      if (!roleRow) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Cache check
    if (!forceRegenerate && jcf.latest_report_generated_at && jcf.updated_at) {
      const gen = new Date(jcf.latest_report_generated_at).getTime();
      const upd = new Date(jcf.updated_at).getTime();
      if (gen >= upd && jcf.latest_report_html) {
        console.log("[generate-jcf-html] Cache HIT");
        return new Response(
          JSON.stringify({ html: jcf.latest_report_html, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }
    }

    // Photos
    const { data: photos } = await supabase
      .from("jcf_photos")
      .select("*")
      .eq("jcf_id", jcfId)
      .is("deleted_at", null)
      .order("display_order");

    const photoList = photos || [];
    const photoEntries: { signedUrl: string; caption: string; section: string }[] = [];

    if (photoList.length > 0) {
      const paths = photoList.map((p: any) => p.photo_url);
      const { data: signedData, error: signedError } = await supabase
        .storage.from("jcf-photos")
        .createSignedUrls(paths, SIGNED_URL_EXPIRY);
      if (!signedError && signedData) {
        for (let i = 0; i < signedData.length; i++) {
          const sd: any = signedData[i];
          if (sd.error || !sd.signedUrl) continue;
          photoEntries.push({
            signedUrl: sd.signedUrl,
            caption: photoList[i].caption || "",
            section: photoList[i].photo_section || "",
          });
        }
      } else if (signedError) {
        console.error("[generate-jcf-html] Signed URL generation failed:", signedError);
      }
    }

    const edits = await fetchPostCompletionEdits(
      supabase, "jcf_reports", jcfId,
      jcf.attestation_signed_at,
    );
    const adminEditBannerHtml = buildAdminEditBanner(edits as any);

    const inspectorName = [
      jcf.profiles?.first_name, jcf.profiles?.last_name,
    ].filter(Boolean).join(" ") || "Inspector";
    const acctNumber = jcf.profiles?.acct_number || "";

    const courseTypes = [
      ["Low", jcf.course_type_low],
      ["High", jcf.course_type_high],
      ["Tower", jcf.course_type_tower],
      ["Zip", jcf.course_type_zip],
      ["Indoor", jcf.course_type_indoor],
      ["Pole-Type", jcf.course_type_poletype],
    ];
    const fallProtection = [
      ["Cable Grab", jcf.fall_protection_cable_grab],
      ["Harness", jcf.fall_protection_harness],
      ["Lift Basket", jcf.fall_protection_lift_basket],
      ["Alternate Access", jcf.fall_protection_alt_access],
    ];

    const headerHtml = `
      <header style="display:flex; align-items:center; justify-content:space-between; padding: 10px 0 16px 0; border-bottom: 2px solid #1B6DB5; margin-bottom: 18px;">
        <img src="${logos.belayReports}" alt="Belay Reports" style="max-height: 64px;">
        <div style="text-align:center; flex: 1;">
          <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 22pt; color: #1B6DB5; margin: 0;">JOB COMPLETION FORM</h1>
          <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; color: #475569; margin-top: 4px;">Belay Reports, Inc. · ACCT Accredited Vendor</div>
        </div>
        <img src="${logos.acct}" alt="ACCT Accredited Vendor" style="max-height: 64px;">
      </header>
    `;

    const identityBody = `
      <table style="width:100%; border-collapse: collapse; font-family: Georgia, 'Times New Roman', serif; font-size: 11pt;">
        <tr><td style="padding:4px 8px; font-weight:bold; width:30%;">Client / Organization</td><td style="padding:4px 8px;">${escapeHtml(jcf.client_name || jcf.organization || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Location</td><td style="padding:4px 8px;">${escapeHtml(jcf.location || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Address</td><td style="padding:4px 8px;">${escapeHtml(jcf.address || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Contact Info</td><td style="padding:4px 8px;">${escapeHtml(jcf.contact_info || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Contract #</td><td style="padding:4px 8px;">${escapeHtml(jcf.contract_number || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Invoice #</td><td style="padding:4px 8px;">${escapeHtml(jcf.invoice_number || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Date of Work</td><td style="padding:4px 8px;">${escapeHtml(formatDate(jcf.date_of_work))}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Job Status</td><td style="padding:4px 8px;">${escapeHtml(jcf.job_status || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Staff On Site</td><td style="padding:4px 8px;">${nl2br(jcf.staff_names)}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Inspector of Record</td><td style="padding:4px 8px;">${escapeHtml(inspectorName)}${acctNumber ? ` · ACCT #${escapeHtml(acctNumber)}` : ""}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;"># Inspectors</td><td style="padding:4px 8px;">${escapeHtml(String(jcf.num_inspectors ?? "—"))}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Hours to Complete</td><td style="padding:4px 8px;">${escapeHtml(String(jcf.hours_to_complete ?? "—"))}</td></tr>
      </table>
    `;

    const courseBody = `
      <div style="margin-bottom: 10px;">
        <div style="font-weight: bold; color:#1e40af; font-size:10.5pt; margin-bottom: 6px;">Course Type</div>
        ${courseTypes.map(([l, v]) => checkbox(String(l), v)).join("")}
        ${checkbox("Other", jcf.course_type_other)}
        ${jcf.course_type_other_text ? `<div style="margin-top:6px;">Other: ${escapeHtml(jcf.course_type_other_text)}</div>` : ""}
      </div>
      <div>
        <div style="font-weight: bold; color:#1e40af; font-size:10.5pt; margin-bottom: 6px;">Fall Protection Used</div>
        ${fallProtection.map(([l, v]) => checkbox(String(l), v)).join("")}
        ${checkbox("Other", jcf.fall_protection_other)}
        ${jcf.fall_protection_other_text ? `<div style="margin-top:6px;">Other: ${escapeHtml(jcf.fall_protection_other_text)}</div>` : ""}
      </div>
    `;

    const safetyBody = `
      <table style="width:100%; border-collapse: collapse; font-family: Georgia, 'Times New Roman', serif; font-size: 11pt;">
        <tr><td style="padding:4px 8px; font-weight:bold; width:30%;">Operations Manual Present</td><td style="padding:4px 8px;">${escapeHtml(yesNo(jcf.manual_present))}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Training Status</td><td style="padding:4px 8px;">${escapeHtml(jcf.training_status || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Emergency Number</td><td style="padding:4px 8px;">${escapeHtml(jcf.emergency_number || "—")}</td></tr>
        <tr><td style="padding:4px 8px; font-weight:bold;">Hospital Info</td><td style="padding:4px 8px;">${nl2br(jcf.hospital_info)}</td></tr>
      </table>
    `;

    const workBody = `
      ${freeText("Contracted Work", jcf.contracted_work)}
      ${freeText("Additional Work Performed", jcf.additional_work_performed)}
      ${freeText("Work Needed to Complete", jcf.work_needed_to_complete)}
      ${freeText("Time & Materials", jcf.time_and_materials)}
      ${freeText("Equipment Left With Client", jcf.equipment_left_with_client)}
      ${freeText("Additional Work This Year", jcf.additional_work_this_year)}
      ${freeText("Work Needed Next Year", jcf.work_needed_next_year)}
      ${freeText("Items to Monitor", jcf.items_to_monitor)}
      ${freeText("Notes", jcf.jcf_notes)}
    `;

    const photosBody = photoEntries.length === 0
      ? '<div style="color:#94a3b8;">No photos attached.</div>'
      : `<div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 14px;">
          ${photoEntries.map((p) => `
            <div style="page-break-inside: avoid;">
              ${p.section ? `<div style="font-size:9.5pt; color:#1e40af; font-weight:bold; margin-bottom:3px;">${escapeHtml(p.section)}</div>` : ""}
              <img src="${p.signedUrl}" alt="JCF photo" style="width:100%; max-height:320px; object-fit:contain; background:#fff; border:1px solid #e2e8f0;">
              <div style="font-size:9.5pt; color:#334155; margin-top:4px;">${p.caption ? escapeHtml(p.caption) : '<span style="color:#94a3b8;">No caption</span>'}</div>
            </div>
          `).join("")}
        </div>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Job Completion Form — ${escapeHtml(jcf.organization || "")}</title>
  <style>
    @page { margin: 18mm; }
    body { font-family: Georgia, 'Times New Roman', serif; color:#0f172a; background:#fff; margin:0; padding: 20px; }
    h1, h2, h3 { font-family: Georgia, 'Times New Roman', serif; }
    table { border-collapse: collapse; }
  </style>
</head>
<body>
  ${adminEditBannerHtml}
  ${headerHtml}
  ${section("Identification & Contract", identityBody)}
  ${section("Course & Fall Protection", courseBody)}
  ${section("Safety & Operations", safetyBody)}
  ${section("Work Performed", workBody)}
  ${section("Photos", photosBody)}
  ${buildAttestationBlock({
    attestation_signed_at: jcf.attestation_signed_at,
    attestation_signer_name: jcf.attestation_signer_name,
    attestation_ip: jcf.attestation_ip,
    attestation_user_agent: jcf.attestation_user_agent,
    attestation_text: jcf.attestation_text,
  })}
  ${buildVersionFooter({
    appVersion: jcf.app_version_at_completion,
    reportVersion: jcf.report_version,
    generatedAt: new Date().toISOString(),
  })}
</body>
</html>`;

    // Cache to DB (best-effort)
    try {
      await supabase
        .from("jcf_reports")
        .update({
          latest_report_html: html,
          latest_report_generated_at: new Date().toISOString(),
        })
        .eq("id", jcfId);
    } catch (e) {
      console.error("[generate-jcf-html] cache write failed:", e);
    }

    return new Response(JSON.stringify({ html }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[generate-jcf-html] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
