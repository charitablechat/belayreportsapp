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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      created_by: null,
    });

    // 4. Generate signed download URL (7 days)
    const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
      .from("database-backups")
      .createSignedUrl(filePath, 60 * 60 * 24 * 7, {
        download: `ropeworks-backup-${timestamp}.json`,
      });

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(`Failed to generate download URL: ${signedUrlError?.message}`);
    }

    // 5. Send email via transactional email system
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

    const { error: emailError } = await adminClient.functions.invoke("send-transactional-email", {
      body: {
        templateName: "backup-notification",
        recipientEmail: "kale@belayreports.com",
        idempotencyKey: `daily-backup-${filePath}`,
        templateData: {
          timestamp: emailTimestamp,
          fileSize: formatFileSize(bytes.length),
          totalRows,
          tableCounts,
          tableCount: Object.keys(tableCounts).length,
          downloadUrl: signedUrlData.signedUrl,
        },
      },
    });

    if (emailError) {
      console.error("[scheduled-backup-notify] Email send error:", emailError);
    } else {
      console.log("[scheduled-backup-notify] Email queued successfully");
    }

    return new Response(
      JSON.stringify({
        success: true,
        file_path: filePath,
        file_size_bytes: bytes.length,
        total_rows: totalRows,
        email_sent: !emailError,
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
