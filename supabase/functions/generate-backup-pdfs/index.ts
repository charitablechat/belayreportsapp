import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CONCURRENCY = 2; // Keep low to avoid timeouts on PDF generation

interface PdfResult {
  generated: number;
  skipped: number;
  errors: number;
  error_details: string[];
}

function sanitizeFilename(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 60);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const mode = body.mode || "incremental";

    console.log(`[generate-backup-pdfs] Mode: ${mode}`);

    const result: PdfResult = {
      generated: 0,
      skipped: 0,
      errors: 0,
      error_details: [],
    };

    // ── Query completed inspections ──
    let inspectionQuery = adminClient
      .from("inspections")
      .select("id, organization, inspection_date, updated_at")
      .eq("status", "completed")
      .is("deleted_at", null);

    if (mode === "incremental") {
      const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      inspectionQuery = inspectionQuery.gte("updated_at", cutoff);
    }

    const { data: inspections } = await inspectionQuery;

    // ── Query completed trainings ──
    let trainingQuery = adminClient
      .from("trainings")
      .select("id, organization, start_date, updated_at")
      .eq("status", "completed")
      .is("deleted_at", null);

    if (mode === "incremental") {
      const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      trainingQuery = trainingQuery.gte("updated_at", cutoff);
    }

    const { data: trainings } = await trainingQuery;

    // ── Build job list ──
    interface Job {
      type: "inspection" | "training";
      id: string;
      org: string;
      date: string;
    }

    const jobs: Job[] = [];

    for (const insp of inspections || []) {
      jobs.push({
        type: "inspection",
        id: insp.id,
        org: insp.organization,
        date: insp.inspection_date,
      });
    }

    for (const tr of trainings || []) {
      jobs.push({
        type: "training",
        id: tr.id,
        org: tr.organization,
        date: tr.start_date,
      });
    }

    console.log(
      `[generate-backup-pdfs] ${jobs.length} reports to process (${inspections?.length || 0} inspections, ${trainings?.length || 0} trainings)`,
    );

    // ── Process in batches ──
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const batch = jobs.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (job) => {
          const org = sanitizeFilename(job.org || "Unknown");
          const idPrefix = job.id.substring(0, 8);
          const folder = job.type === "inspection" ? "inspections" : "trainings";
          const destFilename = `${org}_${job.date}_${idPrefix}.pdf`;
          const destPath = `pdfs/${folder}/${destFilename}`;

          try {
            // Check if already exists in backup bucket
            const { data: existing } = await adminClient.storage
              .from("database-backups")
              .list(`pdfs/${folder}`, { limit: 1, search: destFilename });

            if (existing && existing.some((f: any) => f.name === destFilename)) {
              result.skipped++;
              return;
            }

            // ── Step 1: Call the PDF generator with service-role auth ──
            const functionName = job.type === "inspection"
              ? "generate-inspection-pdf"
              : "generate-training-pdf";

            const bodyPayload = job.type === "inspection"
              ? { inspectionId: job.id }
              : { trainingId: job.id };

            console.log(`[generate-backup-pdfs] Generating ${job.type} PDF for ${job.id}...`);

            const genRes = await fetch(
              `${supabaseUrl}/functions/v1/${functionName}`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${serviceRoleKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(bodyPayload),
              },
            );

            if (!genRes.ok) {
              const errText = await genRes.text();
              throw new Error(`Generator returned ${genRes.status}: ${errText.substring(0, 200)}`);
            }

            const genData = await genRes.json();

            // ── Step 2: Find the generated PDF in inspection-reports bucket ──
            // The generators save with patterns like:
            //   inspection: "inspection-{org}-{timestamp}.pdf" or via inspection_reports table
            //   training: "training-reports/training-report-{id}-{timestamp}.pdf"
            let sourcePath: string | null = null;

            if (job.type === "inspection") {
              // Check inspection_reports table for the file path
              const { data: reportRow } = await adminClient
                .from("inspection_reports")
                .select("pdf_url")
                .eq("inspection_id", job.id)
                .maybeSingle();

              sourcePath = reportRow?.pdf_url || null;
            } else {
              // Training: search in training-reports folder
              const { data: files } = await adminClient.storage
                .from("inspection-reports")
                .list("training-reports", {
                  limit: 10,
                  search: `training-report-${job.id}`,
                });

              const match = files?.find((f: any) =>
                f.name.startsWith(`training-report-${job.id}`) && f.name.endsWith(".pdf")
              );
              sourcePath = match ? `training-reports/${match.name}` : null;
            }

            if (!sourcePath) {
              throw new Error("PDF generated but could not find file in storage");
            }

            // ── Step 3: Download from inspection-reports ──
            const { data: blob, error: dlErr } = await adminClient.storage
              .from("inspection-reports")
              .download(sourcePath);

            if (dlErr || !blob) {
              throw new Error(`Download failed: ${dlErr?.message || "no data"}`);
            }

            // ── Step 4: Upload to database-backups/pdfs/ ──
            const { error: upErr } = await adminClient.storage
              .from("database-backups")
              .upload(destPath, blob, {
                contentType: "application/pdf",
                upsert: false,
              });

            if (upErr) {
              throw new Error(`Upload to backup failed: ${upErr.message}`);
            }

            result.generated++;
            console.log(`[generate-backup-pdfs] ✓ ${destPath}`);
          } catch (err: any) {
            result.errors++;
            if (result.error_details.length < 10) {
              result.error_details.push(`${job.type}/${job.id}: ${err.message}`);
            }
            console.error(`[generate-backup-pdfs] ✗ ${job.type}/${job.id}: ${err.message}`);
          }
        }),
      );
    }

    console.log(
      `[generate-backup-pdfs] Done: generated=${result.generated}, skipped=${result.skipped}, errors=${result.errors}`,
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[generate-backup-pdfs] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
