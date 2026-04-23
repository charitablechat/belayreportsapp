import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BACKUP_TABLES } from "../_shared/backup-tables.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Upsert order: parents first, then children (BACKUP_TABLES is already in that order)
const UPSERT_ORDER = BACKUP_TABLES;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is super admin
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
    const userId = claimsData.claims.sub;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    // M1: Role-based check (backup_operator) instead of hardcoded UUID
    const { data: isBackupAdmin, error: rpcError } = await userClient.rpc("is_backup_admin");
    if (rpcError || !isBackupAdmin) {
      return new Response(JSON.stringify({ error: "Backup access restricted" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    let backupData: any;

    if (body.file_path) {
      // Restore from server-stored backup
      const { data: fileData, error: dlError } = await adminClient.storage
        .from("database-backups")
        .download(body.file_path);

      if (dlError || !fileData) {
        return new Response(
          JSON.stringify({ error: "Failed to download backup file" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await fileData.text();
      backupData = JSON.parse(text);
    } else if (body.data) {
      backupData = body;
    } else {
      return new Response(
        JSON.stringify({ error: "Provide file_path or backup data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!backupData.data || !backupData.version) {
      return new Response(
        JSON.stringify({ error: "Invalid backup format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Record<string, { upserted: number; errors: string[] }> = {};

    for (const table of UPSERT_ORDER) {
      const rows = backupData.data[table];
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        results[table] = { upserted: 0, errors: [] };
        continue;
      }

      const errors: string[] = [];
      // Batch upsert in chunks of 500
      const chunkSize = 500;
      let upserted = 0;

      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await adminClient
          .from(table)
          .upsert(chunk, { onConflict: "id", ignoreDuplicates: false });

        if (error) {
          errors.push(`Chunk ${i}-${i + chunk.length}: ${error.message}`);
        } else {
          upserted += chunk.length;
        }
      }

      results[table] = { upserted, errors };
    }

    return new Response(
      JSON.stringify({
        success: true,
        restored_from: backupData.exported_at,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Restore backup error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
