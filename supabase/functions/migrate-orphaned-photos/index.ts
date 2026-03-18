import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MigrationTarget {
  reportId: string;
  inspectorId: string;
  reportType: "training" | "daily_assessment";
  targetBucket: string;
  targetTable: string;
  foreignKeyColumn: string;
  defaultSection: string;
}

const TARGETS: MigrationTarget[] = [
  {
    reportId: "35649e1b-06d6-4402-b2ce-dc55d3e0a1d0",
    inspectorId: "101e5e1f-62fc-4e65-aecb-073d6e9feedb",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  {
    reportId: "20659307-2e5e-48c5-8dce-1da8801e62af",
    inspectorId: "eefbad83-4601-4b15-9001-33a77b9302bf",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  {
    reportId: "bfe092de-e2a7-41b2-b268-b7ffc10244f3",
    inspectorId: "759e973e-2484-4db3-862a-0cb2ec6d6ea3",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  {
    reportId: "1a406b1f-bf71-4e78-b6cf-d0e037ed6645",
    inspectorId: "101e5e1f-62fc-4e65-aecb-073d6e9feedb",
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Parse body for dry-run mode
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dryRun === true;
    } catch {
      // no body = not dry run
    }

    const results: Record<string, { found: number; migrated: number; skipped: number; errors: string[] }> = {};

    for (const target of TARGETS) {
      const key = `${target.reportType}:${target.reportId.substring(0, 8)}`;
      results[key] = { found: 0, migrated: 0, skipped: 0, errors: [] };

      // List files in inspection-photos under {inspectorId}/{reportId}/
      const folderPath = `${target.inspectorId}/${target.reportId}`;
      const { data: files, error: listError } = await adminClient
        .storage
        .from("inspection-photos")
        .list(folderPath, { limit: 1000 });

      if (listError) {
        results[key].errors.push(`List error: ${listError.message}`);
        continue;
      }

      if (!files || files.length === 0) {
        results[key].errors.push(`No files found in ${folderPath}`);
        continue;
      }

      const validFiles = files.filter((f) => f.name && !f.name.startsWith("."));
      results[key].found = validFiles.length;

      if (dryRun) continue;

      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const sourcePath = `${folderPath}/${file.name}`;
        const destPath = `${target.inspectorId}/${target.reportId}/${file.name}`;

        try {
          // Check if DB record already exists
          const { data: existing } = await adminClient
            .from(target.targetTable)
            .select("id")
            .eq("photo_url", destPath)
            .maybeSingle();

          if (existing) {
            results[key].skipped++;
            continue;
          }

          // Download from inspection-photos
          const { data: fileData, error: dlErr } = await adminClient
            .storage
            .from("inspection-photos")
            .download(sourcePath);

          if (dlErr || !fileData) {
            results[key].errors.push(`DL ${file.name}: ${dlErr?.message}`);
            continue;
          }

          // Upload to correct bucket
          const { error: upErr } = await adminClient
            .storage
            .from(target.targetBucket)
            .upload(destPath, fileData, {
              contentType: fileData.type || "image/jpeg",
              upsert: true,
            });

          if (upErr) {
            results[key].errors.push(`UP ${file.name}: ${upErr.message}`);
            continue;
          }

          // Insert DB record
          const insertData: Record<string, unknown> = {
            [target.foreignKeyColumn]: target.reportId,
            photo_url: destPath,
            photo_section: target.defaultSection,
            display_order: i,
          };

          const { error: dbErr } = await adminClient
            .from(target.targetTable)
            .insert(insertData);

          if (dbErr) {
            results[key].errors.push(`DB ${file.name}: ${dbErr.message}`);
            continue;
          }

          results[key].migrated++;
        } catch (err) {
          results[key].errors.push(`${file.name}: ${err.message}`);
        }
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
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
