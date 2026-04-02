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

// Columns to exclude from specific tables (large regenerable HTML)
const EXCLUDE_COLUMNS: Record<string, string[]> = {
  inspections: ["latest_report_html"],
  trainings: ["latest_report_html"],
  daily_assessments: ["latest_report_html"],
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

async function fetchAllRows(supabase: any, table: string, selectCols: string): Promise<any[]> {
  const allRows: any[] = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
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

function stripColumns(rows: any[], table: string): any[] {
  const excluded = EXCLUDE_COLUMNS[table];
  if (!excluded || excluded.length === 0) return rows;
  return rows.map(row => {
    const cleaned = { ...row };
    for (const col of excluded) {
      delete cleaned[col];
    }
    return cleaned;
  });
}

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }

  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function buildEmailHtml(
  emailTimestamp: string,
  totalSize: string,
  totalRows: number,
  tableCounts: Record<string, number>,
  tableCount: number,
  downloadUrl: string,
  failedTables: string[],
): string {
  const tableRows = Object.entries(tableCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `<tr><td style="padding:4px 12px;border-bottom:1px solid #eee;">${name}</td><td style="padding:4px 12px;border-bottom:1px solid #eee;text-align:right;">${count.toLocaleString()}</td></tr>`)
    .join("");

  const failedWarning = failedTables.length > 0
    ? `<p style="color:#dc2626;font-weight:bold;">⚠️ ${failedTables.length} table upload(s) failed: ${failedTables.join(", ")}</p>`
    : "";

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#1a1a1a;">✅ Daily Backup Complete</h2>
      <p style="color:#555;">${emailTimestamp}</p>
      ${failedWarning}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#555;">Total Rows</td><td style="text-align:right;font-weight:bold;">${totalRows.toLocaleString()}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Tables</td><td style="text-align:right;font-weight:bold;">${tableCount}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Total Size</td><td style="text-align:right;font-weight:bold;">${totalSize}</td></tr>
      </table>
      <p style="margin:16px 0;">
        <a href="${downloadUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">📦 Download Backup (.json)</a>
      </p>
      <p style="font-size:12px;color:#999;">Link expires in 7 days. A compressed .json.gz backup is also attached to this email.</p>
      <details style="margin-top:16px;">
        <summary style="cursor:pointer;color:#555;">Table breakdown</summary>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">
          ${tableRows}
        </table>
      </details>
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

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const tableCounts: Record<string, number> = {};
    const backupData: Record<string, any[]> = {};
    const failedTables: string[] = [];
    let totalSizeBytes = 0;

    // Process each table individually to avoid memory issues
    for (const table of TABLES) {
      let rows = await fetchAllRows(adminClient, table, "*");
      rows = stripColumns(rows, table);
      tableCounts[table] = rows.length;
      backupData[table] = rows;

      if (rows.length === 0) continue;

      const tableJson = JSON.stringify(rows);
      const tableBytes = new TextEncoder().encode(tableJson);
      totalSizeBytes += tableBytes.length;

      const tablePath = `daily/${timestamp}/${table}.json`;
      const { error: uploadErr } = await adminClient.storage
        .from("database-backups")
        .upload(tablePath, tableBytes, {
          contentType: "application/json",
          upsert: false,
        });

      if (uploadErr) {
        console.warn(`[scheduled-backup-notify] Upload error for ${table}: ${uploadErr.message}`);
        failedTables.push(table);
      }
    }

    const totalRows = Object.values(tableCounts).reduce((a, b) => a + b, 0);
    console.log(`[scheduled-backup-notify] Uploaded ${TABLES.length} tables (${totalRows} rows, ${formatFileSize(totalSizeBytes)})`);

    // Upload manifest
    const manifest = {
      version: 1,
      exported_at: now.toISOString(),
      exported_by: "system-scheduled",
      table_counts: tableCounts,
      total_size_bytes: totalSizeBytes,
      tables: TABLES,
      excluded_columns: EXCLUDE_COLUMNS,
      failed_uploads: failedTables,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const { error: manifestUploadErr } = await adminClient.storage
      .from("database-backups")
      .upload(`daily/${timestamp}/manifest.json`, manifestBytes, {
        contentType: "application/json",
        upsert: false,
      });

    if (manifestUploadErr) {
      console.warn(`[scheduled-backup-notify] Manifest upload error: ${manifestUploadErr.message}`);
    }

    // Record in backup_history
    const { error: historyErr } = await adminClient.from("backup_history").insert({
      file_path: `daily/${timestamp}`,
      file_size_bytes: totalSizeBytes,
      table_counts: tableCounts,
      created_by: null,
    });

    if (historyErr) {
      console.warn(`[scheduled-backup-notify] backup_history insert error: ${historyErr.message}`);
    }

    // Generate signed URL for manifest (as entry point)
    const { data: manifestUrlData } = await adminClient.storage
      .from("database-backups")
      .createSignedUrl(`daily/${timestamp}/manifest.json`, 60 * 60 * 24 * 7, {
        download: `ropeworks-backup-manifest-${timestamp}.json`,
      });

    const downloadUrl = manifestUrlData?.signedUrl || "#";

    // Build combined backup JSON, gzip compress, and base64 encode for attachment
    const combinedPayload = {
      version: 1,
      exported_at: now.toISOString(),
      exported_by: "system-scheduled",
      table_counts: tableCounts,
      data: backupData,
    };
    const combinedJson = JSON.stringify(combinedPayload);
    const combinedBytes = new TextEncoder().encode(combinedJson);
    console.log(`[scheduled-backup-notify] Combined backup JSON: ${formatFileSize(combinedBytes.length)}`);

    const gzippedBytes = await gzipCompress(combinedBytes);
    console.log(`[scheduled-backup-notify] Gzip compressed: ${formatFileSize(gzippedBytes.length)}`);

    const base64Attachment = uint8ToBase64(gzippedBytes);

    // Free memory
    backupData && Object.keys(backupData).forEach(k => delete backupData[k]);

    // Send email via Resend with gzip attachment
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

    const html = buildEmailHtml(
      emailTimestamp,
      formatFileSize(totalSizeBytes),
      totalRows,
      tableCounts,
      Object.keys(tableCounts).filter(t => tableCounts[t] > 0).length,
      downloadUrl,
      failedTables,
    );

    const emailSubject = failedTables.length > 0
      ? `⚠️ Ropeworks Daily Backup (${failedTables.length} upload failures) — ${emailTimestamp}`
      : `Ropeworks Daily Backup — ${emailTimestamp}`;

    const emailResponse = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: "Ropeworks <noreply@mail.belayreports.com>",
        to: ["kale@belayreports.com"],
        subject: emailSubject,
        html,
        attachments: [
          {
            filename: `ropeworks-backup-${timestamp}.json.gz`,
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
      console.log("[scheduled-backup-notify] Email sent successfully via Resend with gzip attachment");
    }

    return new Response(
      JSON.stringify({
        success: true,
        backup_path: `daily/${timestamp}`,
        total_size_bytes: totalSizeBytes,
        total_rows: totalRows,
        table_count: Object.keys(tableCounts).filter(t => tableCounts[t] > 0).length,
        email_sent: emailSuccess,
        attachment_size_bytes: gzippedBytes.length,
        failed_uploads: failedTables,
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
