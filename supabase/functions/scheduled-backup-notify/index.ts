import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BACKUP_TABLES } from "../_shared/backup-tables.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TABLES = BACKUP_TABLES;

// Columns to exclude from backup JSON (large regenerable HTML)
const EXCLUDE_COLUMNS: Record<string, string[]> = {
  inspections: ["latest_report_html"],
  trainings: ["latest_report_html"],
  daily_assessments: ["latest_report_html"],
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

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

// ── Denormalized Report Builder ─────────────────────────────────────

interface DenormalizedReport {
  filename: string;
  data: Record<string, any>;
}

// Map of parent table → { child tables, date field, type label }
const REPORT_CONFIG: Record<string, {
  type: string;
  dateField: string;
  children: string[];
}> = {
  inspections: {
    type: "inspection",
    dateField: "inspection_date",
    children: [
      "inspection_systems",
      "inspection_equipment",
      "inspection_standards",
      "inspection_photos",
      "inspection_ziplines",
      "inspection_summary",
    ],
  },
  trainings: {
    type: "training",
    dateField: "start_date",
    children: [
      "training_systems",
      "training_equipment",
      "training_photos",
      "training_operating_systems",
      "training_delivery_approaches",
      "training_verifiable_items",
      "training_immediate_attention",
      "training_systems_in_place",
      "training_summary",
    ],
  },
  daily_assessments: {
    type: "daily-assessment",
    dateField: "assessment_date",
    children: [
      "daily_assessment_beginning_of_day",
      "daily_assessment_end_of_day",
      "daily_assessment_environment_checks",
      "daily_assessment_equipment_checks",
      "daily_assessment_operating_systems",
      "daily_assessment_structure_checks",
      "daily_assessment_photos",
    ],
  },
};

// FK column that links child → parent
function getParentFk(parentTable: string): string {
  if (parentTable === "inspections") return "inspection_id";
  if (parentTable === "trainings") return "training_id";
  return "assessment_id";
}

async function buildDenormalizedReports(
  backupData: Record<string, any[]>,
): Promise<DenormalizedReport[]> {
  const reports: DenormalizedReport[] = [];

  for (const [parentTable, config] of Object.entries(REPORT_CONFIG)) {
    const parentRows = backupData[parentTable] || [];
    const fkCol = getParentFk(parentTable);

    // Pre-index child data by parent ID
    const childIndex: Record<string, Record<string, any[]>> = {};
    for (const childTable of config.children) {
      const childRows = backupData[childTable] || [];
      const shortName = childTable.replace(`${parentTable.replace(/s$/, "")}_`, "")
        .replace(`${parentTable.replace(/ies$/, "y").replace(/s$/, "")}_`, "");
      for (const row of childRows) {
        const pid = row[fkCol];
        if (!pid) continue;
        if (!childIndex[pid]) childIndex[pid] = {};
        if (!childIndex[pid][shortName]) childIndex[pid][shortName] = [];
        childIndex[pid][shortName].push(row);
      }
    }

    for (const parent of parentRows) {
      const org = sanitizeFilename(parent.organization || "Unknown");
      const date = parent[config.dateField] || "undated";
      const idPrefix = (parent.id || "").substring(0, 8);
      const filename = `reports/${config.type}s/${org}_${date}_${idPrefix}.json`;

      // Build denormalized object — parent fields + nested children
      const denormalized: Record<string, any> = {
        _type: config.type,
        ...parent,
      };

      // Attach children
      const children = childIndex[parent.id] || {};
      for (const [childName, childRows] of Object.entries(children)) {
        denormalized[childName] = childRows;
      }

      reports.push({ filename, data: denormalized });
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
  denormalizedReports: number;
  photoBackup?: { total_copied: number; total_skipped: number; total_errors: number; total_size_bytes: number; timed_out: boolean } | null;
  offsiteSync?: { success: boolean; files_synced: number; files_errored: number; timed_out: boolean } | null;
  pdfBackup?: { copied: number; skipped: number; no_source: number; errors: number } | null;
}): string {
  const {
    emailTimestamp, totalSize, totalRows, tableCounts, tableCount,
    downloadUrl, failedTables, denormalizedReports, photoBackup, offsiteSync, pdfBackup,
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

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#1a1a1a;">✅ Daily Backup Complete</h2>
      <p style="color:#555;">${emailTimestamp}</p>
      ${failedWarning}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#555;">Total Rows</td><td style="text-align:right;font-weight:bold;">${totalRows.toLocaleString()}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Tables</td><td style="text-align:right;font-weight:bold;">${tableCount}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">JSON Size</td><td style="text-align:right;font-weight:bold;">${totalSize}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">📋 Denormalized Reports</td><td style="text-align:right;font-weight:bold;">${denormalizedReports}</td></tr>
        ${photoBackup ? `
        <tr><td style="padding:6px 0;color:#555;">📷 Photos Backed Up</td><td style="text-align:right;font-weight:bold;">${photoBackup.total_copied}</td></tr>
        <tr><td style="padding:6px 0;color:#555;">Photos Size</td><td style="text-align:right;font-weight:bold;">${formatFileSize(photoBackup.total_size_bytes)}</td></tr>
        ${photoBackup.total_errors > 0 ? `<tr><td style="padding:6px 0;color:#dc2626;">Photo Errors</td><td style="text-align:right;font-weight:bold;color:#dc2626;">${photoBackup.total_errors}</td></tr>` : ""}
        ${photoBackup.timed_out ? `<tr><td colspan="2" style="padding:6px 0;color:#f59e0b;font-size:12px;">⚠️ Photo backup timed out — partial results</td></tr>` : ""}
        ` : `<tr><td colspan="2" style="padding:6px 0;color:#dc2626;font-size:12px;">⚠️ Photo storage backup was not performed</td></tr>`}
        ${pdfBackup ? `
        <tr><td style="padding:6px 0;color:#555;">📄 PDFs Copied</td><td style="text-align:right;font-weight:bold;">${pdfBackup.copied}</td></tr>
        ${pdfBackup.no_source > 0 ? `<tr><td style="padding:6px 0;color:#555;font-size:12px;">   No existing report</td><td style="text-align:right;font-size:12px;color:#6b7280;">${pdfBackup.no_source}</td></tr>` : ""}
        ${pdfBackup.errors > 0 ? `<tr><td style="padding:6px 0;color:#dc2626;">PDF Errors</td><td style="text-align:right;font-weight:bold;color:#dc2626;">${pdfBackup.errors}</td></tr>` : ""}
        ` : ""}
        ${offsiteSync ? `
        <tr><td style="padding:6px 0;color:#555;">🌐 Off-Site Sync</td><td style="text-align:right;font-weight:bold;color:${offsiteSync.success ? '#059669' : '#dc2626'};">${offsiteSync.success ? `✅ ${offsiteSync.files_synced} files` : '❌ Failed'}</td></tr>
        ${offsiteSync.files_errored > 0 ? `<tr><td style="padding:6px 0;color:#dc2626;">Off-Site Errors</td><td style="text-align:right;font-weight:bold;color:#dc2626;">${offsiteSync.files_errored}</td></tr>` : ""}
        ${offsiteSync.timed_out ? `<tr><td colspan="2" style="padding:6px 0;color:#f59e0b;font-size:12px;">⚠️ Off-site sync timed out — partial results</td></tr>` : ""}
        ` : ""}
      </table>
      <p style="margin:16px 0;">
        <a href="${downloadUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">📦 Download Full Archive</a>
      </p>
      <p style="font-size:12px;color:#999;">Link expires in 7 days. Archive contains backup.json.gz + ${denormalizedReports} denormalized report JSON files.</p>
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

    // ── Webhook secret auth (C1) ──
    const webhookSecret = req.headers.get("x-webhook-secret");
    const { data: secretRow, error: secretError } = await adminClient
      .from("webhook_config")
      .select("key_value")
      .eq("key_name", "WEBHOOK_SECRET")
      .single();
    if (secretError || !secretRow?.key_value) {
      return new Response(JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!webhookSecret || webhookSecret !== secretRow.key_value) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    // ── Step 3: Build denormalized JSON reports ──
    console.log("[scheduled-backup-notify] Building denormalized reports...");
    const denormalizedReports = await buildDenormalizedReports(backupData);
    console.log(`[scheduled-backup-notify] Built ${denormalizedReports.length} denormalized reports`);

    // Upload each denormalized report to storage
    let reportUploadErrors = 0;
    for (const report of denormalizedReports) {
      const reportPath = `daily/${timestamp}/${report.filename}`;
      const reportBytes = new TextEncoder().encode(JSON.stringify(report.data, null, 2));
      const { error } = await adminClient.storage
        .from("database-backups")
        .upload(reportPath, reportBytes, {
          contentType: "application/json",
          upsert: false,
        });
      if (error) {
        reportUploadErrors++;
        if (reportUploadErrors <= 3) {
          console.warn(`[scheduled-backup-notify] Report upload error for ${report.filename}: ${error.message}`);
        }
      }
    }
    if (reportUploadErrors > 0) {
      console.warn(`[scheduled-backup-notify] ${reportUploadErrors} denormalized report upload(s) failed`);
    }

    // ── Step 3.5: Generate backup PDFs (incremental) ──
    let pdfBackupResult: any = null;
    try {
      console.log("[scheduled-backup-notify] Starting incremental PDF generation...");
      const pdfRes = await fetch(
        `${supabaseUrl}/functions/v1/generate-backup-pdfs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ mode: "incremental" }),
        },
      );
      if (pdfRes.ok) {
        pdfBackupResult = await pdfRes.json();
        console.log(
          `[scheduled-backup-notify] PDF backup: copied=${pdfBackupResult.copied}, skipped=${pdfBackupResult.skipped}, no_source=${pdfBackupResult.no_source}, errors=${pdfBackupResult.errors}`,
        );
      } else {
        const errText = await pdfRes.text();
        console.error(`[scheduled-backup-notify] PDF backup failed [${pdfRes.status}]: ${errText}`);
      }
    } catch (pdfErr: any) {
      console.error(`[scheduled-backup-notify] PDF backup error: ${pdfErr.message}`);
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

    // Upload combined backup to storage so off-site sync picks it up
    const { error: gzUploadErr } = await adminClient.storage
      .from("database-backups")
      .upload(`daily/${timestamp}/backup.json.gz`, gzippedBytes, {
        contentType: "application/gzip",
        upsert: false,
      });
    if (gzUploadErr) {
      console.warn(`[scheduled-backup-notify] Failed to upload backup.json.gz: ${gzUploadErr.message}`);
    } else {
      console.log(`[scheduled-backup-notify] Uploaded backup.json.gz to storage (${formatFileSize(gzippedBytes.length)})`);
    }

    // Free memory
    Object.keys(backupData).forEach(k => delete backupData[k]);

    // ── Step 5: Prepare email attachment (just the gzipped JSON) ──
    const attachments: Array<{ filename: string; content: string }> = [
      {
        filename: `ropeworks-backup-${timestamp}.json.gz`,
        content: base64JsonGz,
      },
    ];

    console.log(`[scheduled-backup-notify] Email attachment: ${formatFileSize(gzippedBytes.length)}`);

    // ── Step 6: Upload manifest ──
    const manifest = {
      version: 4,
      exported_at: now.toISOString(),
      exported_by: "system-scheduled",
      table_counts: tableCounts,
      total_size_bytes: totalSizeBytes,
      tables: TABLES,
      excluded_columns: EXCLUDE_COLUMNS,
      failed_uploads: failedTables,
      denormalized_reports: {
        total: denormalizedReports.length,
        upload_errors: reportUploadErrors,
        reports: denormalizedReports.map(r => ({
          filename: r.filename,
          type: r.data._type,
          id: r.data.id,
        })),
      },
      photo_backup: photoBackupResult ? {
        total_copied: photoBackupResult.total_copied,
        total_skipped: photoBackupResult.total_skipped,
        total_errors: photoBackupResult.total_errors,
        total_size_bytes: photoBackupResult.total_size_bytes,
        timed_out: photoBackupResult.timed_out,
        buckets: photoBackupResult.buckets,
      } : null,
      pdf_backup: pdfBackupResult ? {
        generated: pdfBackupResult.generated,
        skipped: pdfBackupResult.skipped,
        no_pdf: pdfBackupResult.no_pdf,
        errors: pdfBackupResult.errors,
      } : null,
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

    // ── Step 8: Sync to external Supabase (off-site backup) ──
    let offsiteSyncResult: any = null;
    try {
      console.log("[scheduled-backup-notify] Starting off-site sync...");
      const offsiteRes = await fetch(
        `${supabaseUrl}/functions/v1/sync-offsite-backup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ backup_path: `daily/${timestamp}` }),
        },
      );
      if (offsiteRes.ok) {
        offsiteSyncResult = await offsiteRes.json();
        const ext = offsiteSyncResult.external_supabase;
        console.log(
          `[scheduled-backup-notify] Off-site sync: synced=${ext?.files_synced}, errors=${ext?.files_errored}, timed_out=${ext?.timed_out}`,
        );
      } else {
        const errText = await offsiteRes.text();
        console.error(`[scheduled-backup-notify] Off-site sync failed [${offsiteRes.status}]: ${errText}`);
      }
    } catch (offsiteErr: any) {
      console.error(`[scheduled-backup-notify] Off-site sync error: ${offsiteErr.message}`);
    }

    // ── Step 9: Generate signed download URL ──
    const { data: manifestUrlData } = await adminClient.storage
      .from("database-backups")
      .createSignedUrl(`daily/${timestamp}/manifest.json`, 60 * 60 * 24 * 7, {
        download: `ropeworks-backup-manifest-${timestamp}.json`,
      });
    const downloadUrl = manifestUrlData?.signedUrl || "#";

    // ── Step 10: Send email ──
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
      denormalizedReports: denormalizedReports.length,
      photoBackup: photoBackupResult,
      pdfBackup: pdfBackupResult,
      offsiteSync: offsiteSyncResult?.external_supabase ? {
        success: offsiteSyncResult.external_supabase.success,
        files_synced: offsiteSyncResult.external_supabase.files_synced,
        files_errored: offsiteSyncResult.external_supabase.files_errored,
        timed_out: offsiteSyncResult.external_supabase.timed_out,
      } : null,
    });

    const emailSubject = failedTables.length > 0
      ? `⚠️ Ropeworks Daily Backup (${failedTables.length} failures) — ${emailTimestamp}`
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

    // ── Step 11: POST to Make.com webhook for off-site archival ──
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
            denormalized_reports: denormalizedReports.length,
            photo_backup: photoBackupResult ? {
              total_copied: photoBackupResult.total_copied,
              total_size_bytes: photoBackupResult.total_size_bytes,
              total_errors: photoBackupResult.total_errors,
              timed_out: photoBackupResult.timed_out,
            } : null,
            offsite_sync: offsiteSyncResult?.external_supabase ? {
              success: offsiteSyncResult.external_supabase.success,
              files_synced: offsiteSyncResult.external_supabase.files_synced,
              files_errored: offsiteSyncResult.external_supabase.files_errored,
            } : null,
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
        denormalized_reports: denormalizedReports.length,
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
