import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

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

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function buildEmailHtml(
  emailTimestamp: string,
  rawSize: string,
  compressedSize: string,
  totalRows: number,
  tableCounts: Record<string, number>,
  tableCount: number,
  downloadUrl: string,
): string {
  const tableRows = Object.entries(tableCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `<tr><td style="padding:4px 12px;border-bottom:1px solid #eee;">${name}</td><td style="padding:4px 12px;border-bottom:1px solid #eee;text-align:right;">${count.toLocaleString()}</td></tr>`)
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#1a1a1a;">✅ Daily Backup Complete</h2>
      <p style="color:#555;">${emailTimestamp}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#555;">Total Rows</td><td style="text-align:right;font-weight:bold;">${totalRows.toLocaleString()}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Tables</td><td style="text-align:right;font-weight:bold;">${tableCount}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Raw Size</td><td style="text-align:right;font-weight:bold;">${rawSize}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Compressed Size</td><td style="text-align:right;font-weight:bold;">${compressedSize}</td></tr>
      </table>
      <p style="margin:16px 0;"><a href="${downloadUrl}" style="color:#2563eb;">Download backup (7-day link)</a></p>
      <details style="margin-top:16px;">
        <summary style="cursor:pointer;color:#555;">Table breakdown</summary>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">
          ${tableRows}
        </table>
      </details>
      <p style="margin-top:24px;font-size:12px;color:#999;">The compressed .json.gz backup file is attached to this email.</p>
    </div>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY_1");

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY_1 is not configured");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

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
    const rawBytes = encoder.encode(jsonStr);

    // 2. Gzip compress for email attachment
    const compressedBytes = await gzipCompress(rawBytes);
    console.log(`[scheduled-backup-notify] Compressed ${formatFileSize(rawBytes.length)} → ${formatFileSize(compressedBytes.length)}`);

    // 3. Upload raw JSON to storage (unchanged)
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const filePath = `backup-${timestamp}.json`;

    const { error: uploadError } = await adminClient.storage
      .from("database-backups")
      .upload(filePath, rawBytes, {
        contentType: "application/json",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    console.log(`[scheduled-backup-notify] Uploaded ${filePath} (${rawBytes.length} bytes)`);

    // 4. Record in backup_history
    await adminClient.from("backup_history").insert({
      file_path: filePath,
      file_size_bytes: rawBytes.length,
      table_counts: tableCounts,
      created_by: null,
    });

    // 5. Generate signed download URL (7 days) — kept for redundancy
    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
      .from("database-backups")
      .createSignedUrl(filePath, 60 * 60 * 24 * 7, {
        download: `ropeworks-backup-${timestamp}.json`,
      });

    const downloadUrl = signedUrlData?.signedUrl || "#";
    if (signedUrlError) {
      console.warn(`[scheduled-backup-notify] Signed URL warning: ${signedUrlError.message}`);
    }

    // 6. Send email with compressed attachment via Resend
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

    const emailTimestamp = `${dateDisplay} at ${timeDisplay}`;
    const dateOnly = now.toISOString().slice(0, 10);

    const html = buildEmailHtml(
      emailTimestamp,
      formatFileSize(rawBytes.length),
      formatFileSize(compressedBytes.length),
      totalRows,
      tableCounts,
      Object.keys(tableCounts).length,
      downloadUrl,
    );

    const base64Attachment = uint8ArrayToBase64(compressedBytes);

    const emailResponse = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: "Ropeworks <noreply@notify.belayreports.com>",
        to: ["kale@belayreports.com"],
        subject: `Ropeworks Daily Backup — ${emailTimestamp}`,
        html,
        attachments: [
          {
            filename: `ropeworks-backup-${dateOnly}.json.gz`,
            content: base64Attachment,
          },
        ],
      }),
    });

    const emailResult = await emailResponse.json();
    const emailSuccess = emailResponse.ok;

    if (!emailSuccess) {
      console.error(`[scheduled-backup-notify] Resend error [${emailResponse.status}]:`, JSON.stringify(emailResult));
    } else {
      console.log("[scheduled-backup-notify] Email sent successfully via Resend");
    }

    return new Response(
      JSON.stringify({
        success: true,
        file_path: filePath,
        file_size_bytes: rawBytes.length,
        compressed_size_bytes: compressedBytes.length,
        total_rows: totalRows,
        email_sent: emailSuccess,
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
