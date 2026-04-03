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

// Tables that contain latest_report_html
const REPORT_TABLES = ["inspections", "trainings", "daily_assessments"] as const;

// Columns to exclude from backup JSON (large regenerable HTML)
const EXCLUDE_COLUMNS: Record<string, string[]> = {
  inspections: ["latest_report_html"],
  trainings: ["latest_report_html"],
  daily_assessments: ["latest_report_html"],
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024; // 35 MB safety limit

// ── Helpers ──────────────────────────────────────────────────────────

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
    for (const col of excluded) delete cleaned[col];
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

function sanitizeFilename(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 60);
}

function getReportTypePath(table: string): string {
  if (table === "inspections") return "inspections";
  if (table === "trainings") return "trainings";
  return "daily-assessments";
}

function getDateField(table: string): string {
  if (table === "inspections") return "inspection_date";
  if (table === "trainings") return "start_date";
  return "assessment_date";
}

// ── HTML Report Extraction ──────────────────────────────────────────

interface HtmlReport {
  filename: string;
  html: string;
  table: string;
  id: string;
}

async function extractHtmlReports(supabase: any): Promise<HtmlReport[]> {
  const reports: HtmlReport[] = [];

  for (const table of REPORT_TABLES) {
    const dateField = getDateField(table);
    const typePath = getReportTypePath(table);

    const rows = await fetchAllRows(
      supabase,
      table,
      `id, organization, ${dateField}, latest_report_html`,
    );

    for (const row of rows) {
      if (!row.latest_report_html) continue;

      const org = sanitizeFilename(row.organization || "Unknown");
      const date = row[dateField] || "undated";
      const idPrefix = (row.id || "").substring(0, 8);
      const filename = `${typePath}/${org}_${date}_${idPrefix}.html`;

      reports.push({
        filename,
        html: row.latest_report_html,
        table,
        id: row.id,
      });
    }
  }

  return reports;
}

// ── Email HTML Builder ──────────────────────────────────────────────

function buildEmailHtml(opts: {
  emailTimestamp: string;
  totalSize: string;
  totalRows: number;
  tableCounts: Record<string, number>;
  tableCount: number;
  downloadUrl: string;
  failedTables: string[];
  totalReports: number;
  attachedReports: number;
  archiveSize: string;
  exceededSizeLimit: boolean;
  photoBackup?: { total_copied: number; total_skipped: number; total_errors: number; total_size_bytes: number; timed_out: boolean } | null;
}): string {
  const {
    emailTimestamp, totalSize, totalRows, tableCounts, tableCount,
    downloadUrl, failedTables, totalReports, attachedReports, archiveSize,
    exceededSizeLimit, photoBackup,
  } = opts;

  const tableRows = Object.entries(tableCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) =>
      `<tr><td style="padding:4px 12px;border-bottom:1px solid #eee;">${name}</td><td style="padding:4px 12px;border-bottom:1px solid #eee;text-align:right;">${count.toLocaleString()}</td></tr>`
    )
    .join("");

  const failedWarning = failedTables.length > 0
    ? `<p style="color:#dc2626;font-weight:bold;">⚠️ ${failedTables.length} table upload(s) failed: ${failedTables.join(", ")}</p>`
    : "";




  const reportAttachNote = exceededSizeLimit
    ? `<p style="font-size:13px;color:#dc2626;font-weight:bold;">⚠️ Full archive too large for email (${archiveSize}) — download all ${totalReports} HTML reports below.</p>`
    : attachedReports > 0
      ? `<p style="font-size:13px;color:#059669;font-weight:bold;">📎 All ${attachedReports} HTML report(s) attached to this email.</p>`
      : "";

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#1a1a1a;">✅ Daily Backup Complete</h2>
      <p style="color:#555;">${emailTimestamp}</p>
      ${failedWarning}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#555;">Total Rows</td><td style="text-align:right;font-weight:bold;">${totalRows.toLocaleString()}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Tables</td><td style="text-align:right;font-weight:bold;">${tableCount}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">JSON Size</td><td style="text-align:right;font-weight:bold;">${totalSize}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">HTML Reports</td><td style="text-align:right;font-weight:bold;">${totalReports}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Archive Size</td><td style="text-align:right;font-weight:bold;">${archiveSize}</td></tr>
        ${photoBackup ? `
        <tr><td style="padding:6px 0;color:#555;">📷 Photos Backed Up</td><td style="text-align:right;font-weight:bold;">${photoBackup.total_copied}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Photos Size</td><td style="text-align:right;font-weight:bold;">${formatFileSize(photoBackup.total_size_bytes)}</td></tr>
        ${photoBackup.total_errors > 0 ? `<tr><td style="padding:6px 0;color:#dc2626;">Photo Errors</td><td style="text-align:right;font-weight:bold;color:#dc2626;">${photoBackup.total_errors}</td></tr>` : ""}
        ${photoBackup.timed_out ? `<tr><td colspan="2" style="padding:6px 0;color:#f59e0b;font-size:12px;">⚠️ Photo backup timed out — partial results</td></tr>` : ""}
        ` : `<tr><td colspan="2" style="padding:6px 0;color:#dc2626;font-size:12px;">⚠️ Photo storage backup was not performed</td></tr>`}
      </table>
      ${reportAttachNote}
      <p style="margin:16px 0;">
        <a href="${downloadUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">📦 Download Full Archive</a>
      </p>
      <p style="font-size:12px;color:#999;">Link expires in 7 days. Archive contains backup.json.gz + all ${totalReports} HTML reports.</p>
      <details style="margin-top:16px;">
        <summary style="cursor:pointer;color:#555;">Table breakdown</summary>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">
          ${tableRows}
        </table>
      </details>
    </div>
  `;
}

// ── Main ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY_1");
    const MAKE_WEBHOOK_URL = Deno.env.get("MAKE_WEBHOOK_URL");

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY_1 is not configured");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    console.log("[scheduled-backup-notify] Starting automated backup...");

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");

    // ── Step 1: Fetch all tables (stripped of HTML blobs) ──
    const tableCounts: Record<string, number> = {};
    const backupData: Record<string, any[]> = {};
    const failedTables: string[] = [];
    let totalSizeBytes = 0;

    for (const table of TABLES) {
      let rows = await fetchAllRows(adminClient, table, "*");
      rows = stripColumns(rows, table);
      tableCounts[table] = rows.length;
      backupData[table] = rows;

      if (rows.length === 0) continue;

      const tableJson = JSON.stringify(rows);
      const tableBytes = new TextEncoder().encode(tableJson);
      totalSizeBytes += tableBytes.length;

      // Upload individual table JSON
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

    // ── Step 2: Backup photo storage blobs ──
    console.log("[scheduled-backup-notify] Starting photo storage backup...");
    let photoBackupResult: any = null;
    try {
      const photoBackupRes = await fetch(
        `${supabaseUrl}/functions/v1/backup-photo-storage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ timestamp }),
        },
      );
      if (photoBackupRes.ok) {
        photoBackupResult = await photoBackupRes.json();
        console.log(
          `[scheduled-backup-notify] Photo backup: copied=${photoBackupResult.total_copied}, skipped=${photoBackupResult.total_skipped}, errors=${photoBackupResult.total_errors}, size=${formatFileSize(photoBackupResult.total_size_bytes)}`,
        );
      } else {
        const errText = await photoBackupRes.text();
        console.error(`[scheduled-backup-notify] Photo backup failed [${photoBackupRes.status}]: ${errText}`);
      }
    } catch (photoErr: any) {
      console.error(`[scheduled-backup-notify] Photo backup error: ${photoErr.message}`);
    }

    // ── Step 3: Extract ALL HTML reports ──
    console.log("[scheduled-backup-notify] Extracting HTML reports...");
    const htmlReports = await extractHtmlReports(adminClient);
    console.log(`[scheduled-backup-notify] Found ${htmlReports.length} total HTML reports`);

    // Upload each HTML report to storage
    let htmlUploadErrors = 0;
    for (const report of htmlReports) {
      const htmlPath = `daily/${timestamp}/reports/${report.filename}`;
      const htmlBytes = new TextEncoder().encode(report.html);
      const { error } = await adminClient.storage
        .from("database-backups")
        .upload(htmlPath, htmlBytes, {
          contentType: "text/html",
          upsert: false,
        });
      if (error) {
        htmlUploadErrors++;
        if (htmlUploadErrors <= 3) {
          console.warn(`[scheduled-backup-notify] HTML upload error for ${report.filename}: ${error.message}`);
        }
      }
    }
    if (htmlUploadErrors > 0) {
      console.warn(`[scheduled-backup-notify] ${htmlUploadErrors} HTML report upload(s) failed`);
    }

    // ── Step 4: Build combined backup JSON (gzip compressed) ──
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

    const base64JsonGz = uint8ToBase64(gzippedBytes);

    // Free memory
    Object.keys(backupData).forEach(k => delete backupData[k]);

    // ── Step 5: Prepare email attachments ──
    const attachments: Array<{ filename: string; content: string }> = [
      {
        filename: `ropeworks-backup-${timestamp}.json.gz`,
        content: base64JsonGz,
      },
    ];

    let totalAttachmentSize = gzippedBytes.length;
    let attachedReportCount = 0;
    let exceededSizeLimit = false;

    // Calculate total size of all HTML reports
    let allReportsSize = 0;
    for (const report of htmlReports) {
      allReportsSize += new TextEncoder().encode(report.html).length;
    }

    if (gzippedBytes.length + allReportsSize <= MAX_ATTACHMENT_BYTES) {
      // All reports fit — attach every one
      for (const report of htmlReports) {
        const htmlBytes = new TextEncoder().encode(report.html);
        attachments.push({
          filename: report.filename.replace(/\//g, "_"),
          content: uint8ToBase64(htmlBytes),
        });
        totalAttachmentSize += htmlBytes.length;
        attachedReportCount++;
      }
      console.log(`[scheduled-backup-notify] Attaching ALL ${attachedReportCount} HTML reports (${formatFileSize(totalAttachmentSize)} total)`);
    } else {
      // Too large — attach only the JSON, provide download link
      exceededSizeLimit = true;
      console.log(`[scheduled-backup-notify] Full archive too large for email (${formatFileSize(gzippedBytes.length + allReportsSize)}), using download link only`);
    }

    // ── Step 6: Upload manifest ──
    const manifest = {
      version: 2,
      exported_at: now.toISOString(),
      exported_by: "system-scheduled",
      table_counts: tableCounts,
      total_size_bytes: totalSizeBytes,
      tables: TABLES,
      excluded_columns: EXCLUDE_COLUMNS,
      failed_uploads: failedTables,
      html_reports: {
        total: htmlReports.length,
        upload_errors: htmlUploadErrors,
        reports: htmlReports.map(r => ({
          filename: r.filename,
          table: r.table,
          id: r.id,
        })),
      },
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    await adminClient.storage
      .from("database-backups")
      .upload(`daily/${timestamp}/manifest.json`, manifestBytes, {
        contentType: "application/json",
        upsert: false,
      });

    // ── Step 7: Record in backup_history ──
    await adminClient.from("backup_history").insert({
      file_path: `daily/${timestamp}`,
      file_size_bytes: totalSizeBytes,
      table_counts: tableCounts,
      created_by: null,
    });

    // ── Step 8: Generate signed download URL ──
    const { data: manifestUrlData } = await adminClient.storage
      .from("database-backups")
      .createSignedUrl(`daily/${timestamp}/manifest.json`, 60 * 60 * 24 * 7, {
        download: `ropeworks-backup-manifest-${timestamp}.json`,
      });
    const downloadUrl = manifestUrlData?.signedUrl || "#";

    // Calculate total archive size (JSON + HTML reports)
    let archiveSizeBytes = totalSizeBytes;
    for (const report of htmlReports) {
      archiveSizeBytes += new TextEncoder().encode(report.html).length;
    }

    // ── Step 9: Send email ──
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

    const html = buildEmailHtml({
      emailTimestamp,
      totalSize: formatFileSize(totalSizeBytes),
      totalRows,
      tableCounts,
      tableCount: Object.keys(tableCounts).filter(t => tableCounts[t] > 0).length,
      downloadUrl,
      failedTables,
      totalReports: htmlReports.length,
      attachedReports: attachedReportCount,
      archiveSize: formatFileSize(archiveSizeBytes),
      exceededSizeLimit,
    });

    const reportLabel = htmlReports.length > 0
      ? ` — ${htmlReports.length} report${htmlReports.length === 1 ? "" : "s"}${exceededSizeLimit ? " (download link)" : " attached"}`
      : "";
    const emailSubject = failedTables.length > 0
      ? `⚠️ Ropeworks Daily Backup${reportLabel} (${failedTables.length} failures) — ${emailTimestamp}`
      : `Ropeworks Daily Backup${reportLabel} — ${emailTimestamp}`;

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
        attachments,
      }),
    });

    const emailResult = await emailResponse.json();
    const emailSuccess = emailResponse.ok;

    if (!emailSuccess) {
      console.error(`[scheduled-backup-notify] Resend error [${emailResponse.status}]:`, JSON.stringify(emailResult));
    } else {
      console.log(`[scheduled-backup-notify] Email sent with ${attachments.length} attachment(s)`);
    }

    // ── Step 10: POST to Make.com webhook for off-site archival ──
    let webhookSuccess = false;
    if (MAKE_WEBHOOK_URL) {
      try {
        const webhookRes = await fetch(MAKE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "daily-backup",
            timestamp: now.toISOString(),
            download_url: downloadUrl,
            total_rows: totalRows,
            total_reports: htmlReports.length,
            archive_size_bytes: archiveSizeBytes,
          }),
        });
        webhookSuccess = webhookRes.ok;
        console.log(`[scheduled-backup-notify] Make.com webhook: ${webhookSuccess ? "OK" : webhookRes.status}`);
      } catch (webhookErr: any) {
        console.warn(`[scheduled-backup-notify] Make.com webhook error: ${webhookErr.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        backup_path: `daily/${timestamp}`,
        total_size_bytes: totalSizeBytes,
        total_rows: totalRows,
        table_count: Object.keys(tableCounts).filter(t => tableCounts[t] > 0).length,
        html_reports: htmlReports.length,
        
        attached_reports: attachedReportCount,
        email_sent: emailSuccess,
        webhook_sent: webhookSuccess,
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
