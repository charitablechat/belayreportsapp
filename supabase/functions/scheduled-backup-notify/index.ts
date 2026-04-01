import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TABLES = [
  "profiles",
  "organizations",
  "organization_members",
  "user_roles",
  "inspections",
  "inspection_systems",
  "inspection_equipment",
  "inspection_standards",
  "inspection_photos",
  "inspection_ziplines",
  "inspection_summary",
  "inspection_reports",
  "trainings",
  "training_systems",
  "training_equipment",
  "training_photos",
  "training_operating_systems",
  "training_delivery_approaches",
  "training_verifiable_items",
  "training_immediate_attention",
  "training_systems_in_place",
  "training_summary",
  "training_reports",
  "daily_assessments",
  "daily_assessment_beginning_of_day",
  "daily_assessment_end_of_day",
  "daily_assessment_environment_checks",
  "daily_assessment_equipment_checks",
  "daily_assessment_operating_systems",
  "daily_assessment_structure_checks",
  "daily_assessment_photos",
  "user_field_history",
  "global_field_history",
  "audit_logs",
  "admin_settings",
  "notification_preferences",
  "push_subscriptions",
  "form_sections",
  "form_fields",
  "form_field_options",
  "form_translations",
  "form_versions",
  "onboarding_resources",
  "onboarding_progress",
  "app_announcements",
];

async function fetchAllRows(supabase: any, table: string): Promise<any[]> {
  const allRows: any[] = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + batchSize - 1);
    if (error) {
      console.warn(`Error fetching ${table}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allRows;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildEmailHtml(params: {
  timestamp: string;
  fileSize: string;
  totalRows: number;
  tableCounts: Record<string, number>;
  downloadUrl: string;
}): string {
  const { timestamp, fileSize, totalRows, tableCounts, downloadUrl } = params;

  const tableRows = Object.entries(tableCounts)
    .sort(([, a], [, b]) => b - a)
    .map(
      ([table, count]) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${table}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${count.toLocaleString()}</td></tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background-color:#1a365d;color:white;padding:24px;text-align:center;">
      <h1 style="margin:0;font-size:22px;">✅ Daily Backup Complete</h1>
      <p style="margin:8px 0 0;font-size:14px;opacity:0.9;">${timestamp}</p>
    </div>
    <div style="padding:24px;">
      <div style="display:flex;gap:16px;margin-bottom:24px;">
        <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:24px;font-weight:bold;color:#166534;">${totalRows.toLocaleString()}</div>
          <div style="font-size:12px;color:#6b7280;">Total Rows</div>
        </div>
        <div style="flex:1;background:#eff6ff;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:24px;font-weight:bold;color:#1e40af;">${fileSize}</div>
          <div style="font-size:12px;color:#6b7280;">File Size</div>
        </div>
        <div style="flex:1;background:#fef3c7;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:24px;font-weight:bold;color:#92400e;">${Object.keys(tableCounts).length}</div>
          <div style="font-size:12px;color:#6b7280;">Tables</div>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${downloadUrl}" style="display:inline-block;background-color:#1a365d;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">
          Download Backup
        </a>
        <p style="font-size:12px;color:#6b7280;margin-top:8px;">Link valid for 7 days</p>
      </div>
      <h3 style="font-size:14px;color:#374151;margin:0 0 12px;">Table Breakdown</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Table</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;">Rows</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div style="background:#f8f9fa;padding:16px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#6b7280;">Rope Works Inc. — Automated Daily Backup</p>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const resend = new Resend(resendApiKey);

    console.log("[scheduled-backup-notify] Starting automated backup...");

    // 1. Export all tables
    const backup: Record<string, any[]> = {};
    const tableCounts: Record<string, number> = {};

    for (const table of TABLES) {
      const rows = await fetchAllRows(adminClient, table);
      backup[table] = rows;
      tableCounts[table] = rows.length;
    }

    const totalRows = Object.values(tableCounts).reduce((a, b) => a + b, 0);

    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      exported_by: "system-scheduled",
      table_counts: tableCounts,
      data: backup,
    };

    const jsonStr = JSON.stringify(payload);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(jsonStr);

    // 2. Upload to storage
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const filePath = `backup-${timestamp}.json`;

    const { error: uploadError } = await adminClient.storage
      .from("database-backups")
      .upload(filePath, bytes, {
        contentType: "application/json",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    console.log(`[scheduled-backup-notify] Uploaded ${filePath} (${bytes.length} bytes)`);

    // 3. Record in backup_history
    await adminClient.from("backup_history").insert({
      file_path: filePath,
      file_size_bytes: bytes.length,
      table_counts: tableCounts,
      created_by: null, // system-scheduled
    });

    // 4. Generate signed download URL (7 days)
    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
      .from("database-backups")
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(`Failed to generate download URL: ${signedUrlError?.message}`);
    }

    // 5. Send email notification
    const dateDisplay = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });

    const timeDisplay = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short",
    });

    const emailHtml = buildEmailHtml({
      timestamp: `${dateDisplay} at ${timeDisplay}`,
      fileSize: formatFileSize(bytes.length),
      totalRows,
      tableCounts,
      downloadUrl: signedUrlData.signedUrl,
    });

    const emailResponse = await resend.emails.send({
      from: "Rope Works <reports@resend.dev>",
      to: ["kale@belayreports.com"],
      subject: `Ropeworks Daily Backup — ${dateDisplay}`,
      html: emailHtml,
    });

    console.log("[scheduled-backup-notify] Email sent:", emailResponse);

    return new Response(
      JSON.stringify({
        success: true,
        file_path: filePath,
        file_size_bytes: bytes.length,
        total_rows: totalRows,
        email_sent: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[scheduled-backup-notify] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
