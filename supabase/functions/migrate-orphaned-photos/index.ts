import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";
interface MigrationTarget {
  reportId: string;
  inspectorId: string;
  reportType: "training" | "daily_assessment";
  targetBucket: string;
  targetTable: string;
  foreignKeyColumn: string;
  defaultSection: string;
}

const ALL_TARGETS: Record<string, MigrationTarget> = {
  "girlscouts": {
    reportId: "35649e1b-06d6-4402-b2ce-dc55d3e0a1d0",
    inspectorId: "101e5e1f-62fc-4e65-aecb-073d6e9feedb",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  "ymca": {
    reportId: "20659307-2e5e-48c5-8dce-1da8801e62af",
    inspectorId: "eefbad83-4601-4b15-9001-33a77b9302bf",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  "southwest": {
    reportId: "bfe092de-e2a7-41b2-b268-b7ffc10244f3",
    inspectorId: "759e973e-2484-4db3-862a-0cb2ec6d6ea3",
    reportType: "training",
    targetBucket: "training-photos",
    targetTable: "training_photos",
    foreignKeyColumn: "training_id",
    defaultSection: "training",
  },
  "marblefalls": {
    reportId: "1a406b1f-bf71-4e78-b6cf-d0e037ed6645",
    inspectorId: "101e5e1f-62fc-4e65-aecb-073d6e9feedb",
    reportType: "daily_assessment",
    targetBucket: "daily-assessment-photos",
    targetTable: "daily_assessment_photos",
    foreignKeyColumn: "assessment_id",
    defaultSection: "assessment",
  },
};

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
    const { data: roleCheck } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleCheck) {
      return new Response(JSON.stringify({ error: "Super admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetKey = "all";
    let dryRun = false;
    let batchSize = 10;
    let offset = 0;
    try {
      const body = await req.json();
      dryRun = body?.dryRun === true;
      targetKey = body?.target || "all";
      batchSize = body?.batchSize || 10;
      offset = body?.offset || 0;
    } catch { /* */ }

    const targets = targetKey === "all"
      ? Object.entries(ALL_TARGETS)
      : [[targetKey, ALL_TARGETS[targetKey]]].filter(([, v]) => v);

    if (targets.length === 0) {
      return new Response(
        JSON.stringify({ error: `Unknown target: ${targetKey}. Valid: ${Object.keys(ALL_TARGETS).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Record<string, { found: number; migrated: number; skipped: number; errors: string[] }> = {};

    for (const [name, target] of targets) {
      const t = target as MigrationTarget;
      results[name as string] = { found: 0, migrated: 0, skipped: 0, errors: [] };
      const r = results[name as string];

      const folderPath = `${t.inspectorId}/${t.reportId}`;
      const { data: files, error: listError } = await adminClient
        .storage.from("inspection-photos").list(folderPath, { limit: 1000 });

      if (listError || !files) {
        r.errors.push(`List: ${listError?.message}`);
        continue;
      }

      const validFiles = files.filter((f) => f.name && !f.name.startsWith("."));
      r.found = validFiles.length;
      if (dryRun) continue;

      // Apply offset and batch size
      const batch = validFiles.slice(offset, offset + batchSize);

      for (let i = 0; i < batch.length; i++) {
        const file = batch[i];
        const sourcePath = `${folderPath}/${file.name}`;
        const destPath = `${t.inspectorId}/${t.reportId}/${file.name}`;

        try {
          // Skip if DB record exists
          const { data: existing } = await adminClient
            .from(t.targetTable).select("id").eq("photo_url", destPath).maybeSingle();
          if (existing) { r.skipped++; continue; }

          // Download
          const { data: blob, error: dlErr } = await adminClient
            .storage.from("inspection-photos").download(sourcePath);
          if (dlErr || !blob) { r.errors.push(`DL ${file.name}: ${dlErr?.message}`); continue; }

          // Upload to correct bucket
          const { error: upErr } = await adminClient
            .storage.from(t.targetBucket).upload(destPath, blob, { contentType: blob.type || "image/jpeg", upsert: true });
          if (upErr) { r.errors.push(`UP ${file.name}: ${upErr.message}`); continue; }

          // Create DB record
          const { error: dbErr } = await adminClient.from(t.targetTable).insert({
            [t.foreignKeyColumn]: t.reportId,
            photo_url: destPath,
            photo_section: t.defaultSection,
            display_order: i,
          });
          if (dbErr) { r.errors.push(`DB ${file.name}: ${dbErr.message}`); continue; }

          r.migrated++;
        } catch (err) {
          r.errors.push(`${file.name}: ${err.message}`);
        }
      }
    }

    const totalFound = Object.values(results).reduce((s, r) => s + r.found, 0);
    const totalMigrated = Object.values(results).reduce((s, r) => s + r.migrated, 0);
    const totalSkipped = Object.values(results).reduce((s, r) => s + r.skipped, 0);

    return new Response(
      JSON.stringify({ success: true, dryRun, offset, batchSize, summary: { totalFound, totalMigrated, totalSkipped }, details: results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
