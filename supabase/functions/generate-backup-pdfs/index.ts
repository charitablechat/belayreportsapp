import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CONCURRENCY = 3;

interface PdfResult {
  generated: number;
  skipped: number;
  no_pdf: number;
  errors: number;
  error_details: string[];
}

function sanitizeFilename(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 60);
}

/**
 * Find a training PDF file path in storage by training ID.
 * Training PDFs are stored as `training-reports/training-report-{id}-{timestamp}.pdf`
 * in the `inspection-reports` bucket.
 */
async function findTrainingPdfPath(
  adminClient: any,
  trainingId: string,
): Promise<string | null> {
  const { data: files } = await adminClient.storage
    .from("inspection-reports")
    .list("training-reports", { limit: 100, search: `training-report-${trainingId}` });

  if (!files || files.length === 0) return null;

  const match = files.find((f: any) =>
    f.name.startsWith(`training-report-${trainingId}-`) && f.name.endsWith(".pdf")
  );

  return match ? `training-reports/${match.name}` : null;
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
    const mode = body.mode || "incremental"; // "backfill" or "incremental"

    console.log(`[generate-backup-pdfs] Mode: ${mode}`);

    const result: PdfResult = {
      generated: 0,
      skipped: 0,
      no_pdf: 0,
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
      const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h for safety
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

    // ── Get existing inspection PDF file paths from inspection_reports table ──
    const inspectionIds = (inspections || []).map((i: any) => i.id);
    const { data: inspectionReports } =
      inspectionIds.length > 0
        ? await adminClient
            .from("inspection_reports")
            .select("inspection_id, pdf_url")
            .in("inspection_id", inspectionIds)
        : { data: [] };

    // inspection_reports.pdf_url stores the storage file path (e.g. "inspection-OrgName-123.pdf")
    const inspectionPdfMap = new Map(
      (inspectionReports || []).map((r: any) => [r.inspection_id, r.pdf_url]),
    );

    // ── Build job list ──
    interface CopyJob {
      type: "inspections" | "trainings";
      id: string;
      org: string;
      date: string;
      storagePath: string | null; // path in inspection-reports bucket
    }

    const jobs: CopyJob[] = [];

    for (const insp of inspections || []) {
      jobs.push({
        type: "inspections",
        id: insp.id,
        org: insp.organization,
        date: insp.inspection_date,
        storagePath: inspectionPdfMap.get(insp.id) || null,
      });
    }

    for (const tr of trainings || []) {
      // Training pdf_url stores a signed URL (useless), so we find the file by listing storage
      jobs.push({
        type: "trainings",
        id: tr.id,
        org: tr.organization,
        date: tr.start_date,
        storagePath: null, // resolved per-job below
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
          const destFilename = `${org}_${job.date}_${idPrefix}.pdf`;
          const destPath = `pdfs/${job.type}/${destFilename}`;

          try {
            // Check if already exists in backup bucket
            const { data: existing } = await adminClient.storage
              .from("database-backups")
              .list(`pdfs/${job.type}`, {
                limit: 1,
                search: destFilename,
              });

            if (
              existing &&
              existing.some((f: any) => f.name === destFilename)
            ) {
              result.skipped++;
              return;
            }

            // Resolve storage path for trainings
            let sourcePath = job.storagePath;
            if (job.type === "trainings" && !sourcePath) {
              sourcePath = await findTrainingPdfPath(adminClient, job.id);
            }

            if (!sourcePath) {
              result.no_pdf++;
              return;
            }

            // Download from inspection-reports bucket
            const { data: blob, error: dlErr } = await adminClient.storage
              .from("inspection-reports")
              .download(sourcePath);

            if (dlErr || !blob) {
              throw new Error(
                `Download failed: ${dlErr?.message || "no data"}`,
              );
            }

            // Upload to database-backups/pdfs/
            const { error: upErr } = await adminClient.storage
              .from("database-backups")
              .upload(destPath, blob, {
                contentType: "application/pdf",
                upsert: false,
              });

            if (upErr) {
              throw new Error(`Upload failed: ${upErr.message}`);
            }

            result.generated++;
          } catch (err: any) {
            result.errors++;
            if (result.error_details.length < 10) {
              result.error_details.push(
                `${job.type}/${job.id}: ${err.message}`,
              );
            }
          }
        }),
      );
    }

    console.log(
      `[generate-backup-pdfs] Done: generated=${result.generated}, skipped=${result.skipped}, no_pdf=${result.no_pdf}, errors=${result.errors}`,
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
