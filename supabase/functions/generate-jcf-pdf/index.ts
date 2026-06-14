// Generate Job Completion Form (JCF) PDF using jsPDF + autotable.
// Belay Reports branding · Header logos on page 1 only · Footer page numbers + ACCT disclaimer on every page.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import "https://esm.sh/jspdf-autotable@3.8.2";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";
import { corsHeaders } from "../_shared/cors.ts";

function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  const dateOnly = String(dateStr).split("T")[0];
  const parts = dateOnly.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts.map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
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

function checkedList(items: [string, any][]): string {
  return items.map(([l, v]) => `${v ? "[X]" : "[ ]"} ${l}`).join("   ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;

    let user: any = null;
    if (isServiceRole) {
      console.log("[generate-jcf-pdf] service-role caller — skipping rate limit");
    } else {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authUser) throw new Error("Unauthorized");
      user = authUser;

      const rateLimit = checkRateLimit(`pdf:jcf:${user.id}`, {
        maxRequests: 10,
        windowMs: 60 * 60 * 1000,
      });
      if (!rateLimit.allowed) {
        console.warn(`[generate-jcf-pdf] Rate limit exceeded for ${user.id}`);
        return createRateLimitResponse(rateLimit.resetAt, corsHeaders);
      }
    }

    const { jcfId } = await req.json();
    if (!jcfId) throw new Error("jcfId is required");

    const [
      { data: jcf, error: jcfError },
      { data: photos },
    ] = await Promise.all([
      supabase.from("jcf_reports").select("*").eq("id", jcfId).single(),
      supabase.from("jcf_photos").select("*").eq("jcf_id", jcfId).is("deleted_at", null).order("display_order"),
    ]);
    if (jcfError) throw jcfError;
    if (!jcf) throw new Error("JCF report not found");

    if (!isServiceRole) {
      const isAdmin = await supabase.from("user_roles").select("role").eq("user_id", user.id).in("role", ["admin", "super_admin"]).maybeSingle();
      if (!isAdmin.data && jcf.inspector_id !== user.id) throw new Error("Unauthorized to generate this report");
    }

    const { data: inspectorProfile } = await supabase
      .from("profiles").select("first_name, last_name, acct_number").eq("id", jcf.inspector_id).maybeSingle();
    const inspectorName = `${inspectorProfile?.first_name || ""} ${inspectorProfile?.last_name || ""}`.trim() || "Inspector";

    // Fetch logo
    let logoBase64 = "";
    try {
      const _supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const logoResp = await fetch(`${_supabaseUrl}/storage/v1/object/public/pdf-templates/belay-reports-logo.png`);
      if (logoResp.ok) {
        const buf = new Uint8Array(await logoResp.arrayBuffer());
        const binary = buf.reduce((a, b) => a + String.fromCharCode(b), "");
        logoBase64 = btoa(binary);
      }
    } catch (e) {
      console.error("[generate-jcf-pdf] logo fetch failed:", e);
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as any;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    const footerZone = 30; // per Belay pagination memory
    let yPos = margin;

    const checkPageBreak = (h: number) => {
      if (yPos + h > pageHeight - footerZone) {
        doc.addPage();
        yPos = margin;
      }
    };

    // ---------------- Page 1 Header (logos page-1 only) ----------------
    doc.setFillColor(27, 109, 181); // #1B6DB5
    doc.rect(0, 0, pageWidth, 35, "F");
    if (logoBase64) {
      try { doc.addImage(`data:image/png;base64,${logoBase64}`, "PNG", margin, 8, 20, 20); }
      catch (e) { console.error("logo add failed:", e); }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("times", "bold");
    doc.setFontSize(22);
    doc.text("BELAY REPORTS INC.", pageWidth / 2, 15, { align: "center" });
    doc.setFont("times", "normal");
    doc.setFontSize(14);
    doc.text("Job Completion Form", pageWidth / 2, 25, { align: "center" });
    yPos = 45;
    doc.setTextColor(0, 0, 0);

    const sectionHeading = (title: string) => {
      checkPageBreak(15);
      doc.setFont("times", "bold");
      doc.setFontSize(13);
      doc.setTextColor(27, 109, 181);
      doc.text(title, margin, yPos);
      yPos += 6;
      doc.setDrawColor(27, 109, 181);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      doc.setTextColor(0, 0, 0);
      doc.setFont("times", "normal");
      doc.setFontSize(11);
    };

    // ---------- Identification ----------
    sectionHeading("Identification & Contract");
    doc.autoTable({
      startY: yPos,
      theme: "plain",
      styles: { font: "times", fontSize: 10, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 }, 1: { cellWidth: "auto" } },
      margin: { left: margin, right: margin },
      body: [
        ["Client / Organization", stripHtml(jcf.client_name) || stripHtml(jcf.organization) || "—"],
        ["Location", stripHtml(jcf.location) || "—"],
        ["Address", stripHtml(jcf.address) || "—"],
        ["Contact Info", stripHtml(jcf.contact_info) || "—"],
        ["Contract #", stripHtml(jcf.contract_number) || "—"],
        ["Invoice #", stripHtml(jcf.invoice_number) || "—"],
        ["Date of Work", formatDate(jcf.date_of_work)],
        ["Job Status", stripHtml(jcf.job_status) || "—"],
        ["Staff On Site", stripHtml(jcf.staff_names) || "—"],
        ["Inspector of Record", inspectorName + (inspectorProfile?.acct_number ? ` · ACCT #${inspectorProfile.acct_number}` : "")],
        ["# Inspectors", jcf.num_inspectors != null ? String(jcf.num_inspectors) : "—"],
        ["Hours to Complete", jcf.hours_to_complete != null ? String(jcf.hours_to_complete) : "—"],
      ],
    });
    yPos = doc.lastAutoTable.finalY + 8;

    // ---------- Course Type / Fall Protection ----------
    sectionHeading("Course & Fall Protection");
    const courseLine = "Course Type:  " + checkedList([
      ["Low", jcf.course_type_low],
      ["High", jcf.course_type_high],
      ["Tower", jcf.course_type_tower],
      ["Zip", jcf.course_type_zip],
      ["Indoor", jcf.course_type_indoor],
      ["Pole-Type", jcf.course_type_poletype],
      ["Other", jcf.course_type_other],
    ]);
    const fallLine = "Fall Protection:  " + checkedList([
      ["Cable Grab", jcf.fall_protection_cable_grab],
      ["Harness", jcf.fall_protection_harness],
      ["Lift Basket", jcf.fall_protection_lift_basket],
      ["Alt Access", jcf.fall_protection_alt_access],
      ["Other", jcf.fall_protection_other],
    ]);
    for (const line of [courseLine, fallLine]) {
      const wrapped = doc.splitTextToSize(line, contentWidth);
      wrapped.forEach((w: string) => { checkPageBreak(5); doc.text(w, margin, yPos); yPos += 5; });
    }
    if (jcf.course_type_other_text) {
      const w = doc.splitTextToSize(`Course Other: ${stripHtml(jcf.course_type_other_text)}`, contentWidth);
      w.forEach((x: string) => { checkPageBreak(5); doc.text(x, margin, yPos); yPos += 5; });
    }
    if (jcf.fall_protection_other_text) {
      const w = doc.splitTextToSize(`Fall Protection Other: ${stripHtml(jcf.fall_protection_other_text)}`, contentWidth);
      w.forEach((x: string) => { checkPageBreak(5); doc.text(x, margin, yPos); yPos += 5; });
    }
    yPos += 4;

    // ---------- Safety & Ops ----------
    sectionHeading("Safety & Operations");
    doc.autoTable({
      startY: yPos,
      theme: "plain",
      styles: { font: "times", fontSize: 10, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 }, 1: { cellWidth: "auto" } },
      margin: { left: margin, right: margin },
      body: [
        ["Operations Manual Present", yesNo(jcf.manual_present)],
        ["Training Status", stripHtml(jcf.training_status) || "—"],
        ["Emergency Number", stripHtml(jcf.emergency_number) || "—"],
        ["Hospital Info", stripHtml(jcf.hospital_info) || "—"],
      ],
    });
    yPos = doc.lastAutoTable.finalY + 8;

    // ---------- Free-text work sections ----------
    const freeFields: [string, string | null | undefined][] = [
      ["Contracted Work", jcf.contracted_work],
      ["Additional Work Performed", jcf.additional_work_performed],
      ["Work Needed to Complete", jcf.work_needed_to_complete],
      ["Time & Materials", jcf.time_and_materials],
      ["Equipment Left With Client", jcf.equipment_left_with_client],
      ["Additional Work This Year", jcf.additional_work_this_year],
      ["Work Needed Next Year", jcf.work_needed_next_year],
      ["Items to Monitor", jcf.items_to_monitor],
      ["Notes", jcf.jcf_notes],
    ];
    sectionHeading("Work Performed");
    for (const [label, val] of freeFields) {
      const text = stripHtml(val) || "—";
      checkPageBreak(10);
      doc.setFont("times", "bold");
      doc.setTextColor(30, 64, 175);
      doc.text(label, margin, yPos);
      yPos += 5;
      doc.setFont("times", "normal");
      doc.setTextColor(0, 0, 0);
      const lines = doc.splitTextToSize(text, contentWidth);
      lines.forEach((l: string) => { checkPageBreak(5); doc.text(l, margin, yPos); yPos += 5; });
      yPos += 3;
    }

    // ---------- Photos ----------
    if (photos && photos.length > 0) {
      sectionHeading("Photos");
      const photoWidth = 80;
      const photoHeight = 60;
      let col = 0;
      let rowY = yPos;
      for (const p of photos as any[]) {
        try {
          const { data: signed } = await supabase.storage.from("jcf-photos").createSignedUrl(p.photo_url, 3600);
          if (!signed?.signedUrl) continue;
          const imgResp = await fetch(signed.signedUrl);
          if (!imgResp.ok) continue;
          const buf = new Uint8Array(await imgResp.arrayBuffer());
          const bin = buf.reduce((a, b) => a + String.fromCharCode(b), "");
          const b64 = btoa(bin);
          const x = margin + col * (photoWidth + 10);
          if (rowY + photoHeight + 12 > pageHeight - footerZone) {
            doc.addPage();
            rowY = margin;
            col = 0;
          }
          const xx = margin + col * (photoWidth + 10);
          doc.addImage(`data:image/jpeg;base64,${b64}`, "JPEG", xx, rowY, photoWidth, photoHeight);
          doc.setFontSize(8);
          doc.setTextColor(0, 0, 0);
          const caption = stripHtml(p.caption) || "";
          if (caption) doc.text(doc.splitTextToSize(caption, photoWidth), xx, rowY + photoHeight + 4);
          col++;
          if (col >= 2) { col = 0; rowY += photoHeight + 16; }
        } catch (e) {
          console.error("photo render failed:", e);
        }
      }
      yPos = rowY + photoHeight + 16;
    }

    // ---------- Footer (all pages) ----------
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18);
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.setFont("times", "normal");
      doc.text("Belay Reports, Inc. · ACCT Accredited Vendor", pageWidth / 2, pageHeight - 12, { align: "center" });
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 12, { align: "right" });
      if (inspectorProfile?.acct_number) {
        doc.text(`ACCT #: ${inspectorProfile.acct_number}`, margin, pageHeight - 12);
      }
    }

    const pdfBytes = doc.output("arraybuffer");
    const pdfArr = new Uint8Array(pdfBytes);
    const safeOrg = (jcf.organization || "JCF").replace(/[^a-z0-9]/gi, "_");
    const fileName = `jcf-${safeOrg}-${Date.now()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("inspection-reports")
      .upload(fileName, pdfArr, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw uploadError;

    const { data: signedUrlData, error: signedErr } = await supabase.storage
      .from("inspection-reports")
      .createSignedUrl(fileName, 3600);
    if (signedErr) throw signedErr;

    return new Response(JSON.stringify({ success: true, url: signedUrlData.signedUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[generate-jcf-pdf] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
