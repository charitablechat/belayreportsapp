import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MigrationTarget {
  reportId: string;
  reportType: "training" | "daily_assessment";
  targetBucket: string;
  targetTable: string;
  foreignKeyColumn: string;
  defaultSection: string;
}

const TARGETS: MigrationTarget[] = [
  {
    reportId: "35649e1b",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  {
    reportId: "20659307",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  {
    reportId: "bfe092de",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  {
    reportId: "1a406b1f",
    reportType: "daily_assessment",
    targetBucket: "daily-assessment-photos",
    targetTable: "daily_assessment_photos",
    foreignKeyColumn: "assessment_id",
    defaultSection: "assessment",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is super admin
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "super_admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Super admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse optional body for dry-run mode
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dryRun === true;
    } catch {
      // no body = not dry run
    }

    const results: Record<string, { found: number; migrated: number; skipped: number; errors: string[] }> = {};

    for (const target of TARGETS) {
      const key = `${target.reportType}:${target.reportId}`;
      results[key] = { found: 0, migrated: 0, skipped: 0, errors: [] };

      // Find the full UUID of the report
      const table = target.reportType === "training" ? "trainings" : "daily_assessments";
      const { data: reports } = await adminClient
        .from(table)
        .select("id, inspector_id")
        .ilike("id", `${target.reportId}%`);

      if (!reports || reports.length === 0) {
        results[key].errors.push(`No ${target.reportType} found with ID prefix ${target.reportId}`);
        continue;
      }

      const report = reports[0];
      const fullReportId = report.id;
      const inspectorId = report.inspector_id;

      // List all files in inspection-photos that belong to this report
      // Files are stored as: {userId}/{reportId}/{filename}
      // We need to search across all user folders
      const { data: allObjects, error: listError } = await adminClient
        .storage
        .from("inspection-photos")
        .list(inspectorId, { limit: 1000 });

      if (listError) {
        results[key].errors.push(`List error: ${listError.message}`);
        continue;
      }

      // Filter for files that match this report ID (they're in subfolders)
      // The structure is: {userId}/{filename} or {userId}/{reportId}-{uuid}.{ext}
      // Actually let's list the subfolder directly
      const { data: reportFiles, error: reportListError } = await adminClient
        .storage
        .from("inspection-photos")
        .list(`${inspectorId}/${fullReportId}`, { limit: 1000 });

      let filesToMigrate: { name: string; sourcePath: string }[] = [];

      if (reportFiles && reportFiles.length > 0) {
        // Files are in {userId}/{reportId}/ subfolder
        filesToMigrate = reportFiles
          .filter((f) => f.name && !f.name.endsWith("/"))
          .map((f) => ({
            name: f.name,
            sourcePath: `${inspectorId}/${fullReportId}/${f.name}`,
          }));
      }

      // Also check for files directly under the user folder that contain the report ID
      if (allObjects) {
        const directFiles = allObjects
          .filter((f) => f.name && f.name.includes(fullReportId.substring(0, 8)))
          .map((f) => ({
            name: f.name,
            sourcePath: `${inspectorId}/${f.name}`,
          }));
        filesToMigrate.push(...directFiles);
      }

      results[key].found = filesToMigrate.length;

      if (dryRun) {
        continue;
      }

      for (const file of filesToMigrate) {
        try {
          // Check if already migrated (record exists in target table)
          const destPath = `${inspectorId}/${fullReportId}/${file.name}`;
          const { data: existing } = await adminClient
            .from(target.targetTable)
            .select("id")
            .eq("photo_url", destPath)
            .maybeSingle();

          if (existing) {
            results[key].skipped++;
            continue;
          }

          // Download from source bucket
          const { data: fileData, error: downloadError } = await adminClient
            .storage
            .from("inspection-photos")
            .download(file.sourcePath);

          if (downloadError || !fileData) {
            results[key].errors.push(`Download ${file.sourcePath}: ${downloadError?.message}`);
            continue;
          }

          // Upload to destination bucket
          const { error: uploadError } = await adminClient
            .storage
            .from(target.targetBucket)
            .upload(destPath, fileData, {
              contentType: fileData.type || "image/jpeg",
              upsert: true,
            });

          if (uploadError) {
            results[key].errors.push(`Upload ${destPath}: ${uploadError.message}`);
            continue;
          }

          // Create database record
          const insertData: Record<string, unknown> = {
            [target.foreignKeyColumn]: fullReportId,
            photo_url: destPath,
            photo_section: target.defaultSection,
            display_order: results[key].migrated,
          };

          const { error: insertError } = await adminClient
            .from(target.targetTable)
            .insert(insertData);

          if (insertError) {
            results[key].errors.push(`DB insert ${destPath}: ${insertError.message}`);
            continue;
          }

          results[key].migrated++;
        } catch (err) {
          results[key].errors.push(`File ${file.name}: ${err.message}`);
        }
      }

      // Clean up source files after successful migration
      if (results[key].migrated > 0) {
        const pathsToDelete = filesToMigrate
          .slice(0, results[key].migrated + results[key].skipped)
          .map((f) => f.sourcePath);

        // Only delete files that were successfully migrated
        // We'll skip deletion for now to be safe - can be done in a follow-up
      }
    }

    const totalFound = Object.values(results).reduce((s, r) => s + r.found, 0);
    const totalMigrated = Object.values(results).reduce((s, r) => s + r.migrated, 0);
    const totalSkipped = Object.values(results).reduce((s, r) => s + r.skipped, 0);

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        summary: { totalFound, totalMigrated, totalSkipped },
        details: results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
