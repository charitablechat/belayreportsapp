import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    let userId: string | null = null;

    // Check for webhook secret (cron job) OR super admin auth
    const webhookSecret = req.headers.get("x-webhook-secret");
    const storedWebhookSecret = Deno.env.get("WEBHOOK_SECRET");

    if (webhookSecret && storedWebhookSecret && webhookSecret === storedWebhookSecret) {
      // Cron-triggered: authenticated via webhook secret
      userId = "system-cron";
    } else {
      // User-triggered: verify super admin
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = claimsData.claims.sub;

      // Only Kale can access backups
      const BACKUP_ADMIN_ID = '759e973e-2484-4db3-862a-0cb2ec6d6ea3';
      if (userId !== BACKUP_ADMIN_ID) {
        return new Response(JSON.stringify({ error: "Backup access restricted" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Export all tables
    const backup: Record<string, any[]> = {};
    const tableCounts: Record<string, number> = {};

    for (const table of TABLES) {
      const rows = await fetchAllRows(adminClient, table);
      backup[table] = rows;
      tableCounts[table] = rows.length;
    }

    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      exported_by: userId,
      table_counts: tableCounts,
      data: backup,
    };

    const jsonStr = JSON.stringify(payload);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(jsonStr);

    // Upload to storage
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
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

    // Record in backup_history
    const { error: historyError } = await adminClient
      .from("backup_history")
      .insert({
        file_path: filePath,
        file_size_bytes: bytes.length,
        table_counts: tableCounts,
        created_by: userId === "system-cron" ? null : userId,
      });

    if (historyError) {
      console.warn("Failed to record backup history:", historyError.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        file_path: filePath,
        file_size_bytes: bytes.length,
        table_counts: tableCounts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Export backup error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
