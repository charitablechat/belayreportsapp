import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";
const CONCURRENCY = 5;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface SyncResult {
  success: boolean;
  files_synced: number;
  files_skipped: number;
  files_errored: number;
  total_size_bytes: number;
  errors: string[];
  timed_out: boolean;
}

async function listAllFiles(
  supabase: any,
  bucket: string,
  prefix: string,
): Promise<Array<{ name: string; path: string; size: number }>> {
  const allFiles: Array<{ name: string; path: string; size: number }> = [];

  async function listRecursive(currentPrefix: string) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(currentPrefix, { limit: 1000 });

    if (error || !data) return;

    for (const item of data) {
      const fullPath = currentPrefix ? `${currentPrefix}/${item.name}` : item.name;
      if (item.id) {
        // It's a file
        allFiles.push({
          name: item.name,
          path: fullPath,
          size: item.metadata?.size || 0,
        });
      } else {
        // It's a folder — recurse
        await listRecursive(fullPath);
      }
    }
  }

  await listRecursive(prefix);
  return allFiles;
}

async function syncToExternalSupabase(
  sourceClient: any,
  backupPath: string,
  deadline: number,
): Promise<SyncResult> {
  const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
  const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_KEY");

  if (!extUrl || !extKey) {
    return {
      success: false,
      files_synced: 0,
      files_skipped: 0,
      files_errored: 0,
      total_size_bytes: 0,
      errors: ["EXTERNAL_SUPABASE_URL or EXTERNAL_SUPABASE_SERVICE_KEY not configured"],
      timed_out: false,
    };
  }

  const extClient = createClient(extUrl, extKey);
  const result: SyncResult = {
    success: true,
    files_synced: 0,
    files_skipped: 0,
    files_errored: 0,
    total_size_bytes: 0,
    errors: [],
    timed_out: false,
  };

  // List all files in the backup folder
  const files = await listAllFiles(sourceClient, "database-backups", backupPath);
  console.log(`[sync-offsite] Found ${files.length} files in ${backupPath}`);

  // Process in batches of CONCURRENCY
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    if (Date.now() > deadline) {
      result.timed_out = true;
      console.warn("[sync-offsite] Timeout reached, stopping sync");
      break;
    }

    const batch = files.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (file) => {
      try {
        // Check if file already exists on destination (idempotent)
        const { data: existing } = await extClient.storage
          .from("ropeworks-backups")
          .list(file.path.substring(0, file.path.lastIndexOf("/")), {
            limit: 1,
            search: file.name,
          });

        if (existing && existing.length > 0 && existing.some((e: any) => e.name === file.name)) {
          result.files_skipped++;
          return;
        }

        // Download from source
        const { data: blob, error: dlErr } = await sourceClient.storage
          .from("database-backups")
          .download(file.path);

        if (dlErr || !blob) {
          throw new Error(`Download failed: ${dlErr?.message || "no data"}`);
        }

        // Determine content type
        let contentType = "application/octet-stream";
        if (file.name.endsWith(".json")) contentType = "application/json";
        else if (file.name.endsWith(".json.gz")) contentType = "application/gzip";
        else if (file.name.endsWith(".html")) contentType = "text/html";
        else if (file.name.endsWith(".jpg") || file.name.endsWith(".jpeg")) contentType = "image/jpeg";
        else if (file.name.endsWith(".png")) contentType = "image/png";
        else if (file.name.endsWith(".webp")) contentType = "image/webp";

        // Upload to destination
        const { error: upErr } = await extClient.storage
          .from("ropeworks-backups")
          .upload(file.path, blob, {
            contentType,
            upsert: false,
          });

        if (upErr) {
          throw new Error(`Upload failed: ${upErr.message}`);
        }

        result.files_synced++;
        result.total_size_bytes += file.size || (blob as Blob).size || 0;
      } catch (err: any) {
        result.files_errored++;
        if (result.errors.length < 10) {
          result.errors.push(`${file.path}: ${err.message}`);
        }
      }
    });

    await Promise.all(promises);
  }

  result.success = result.files_errored === 0 && !result.timed_out;
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth check — service-role or backup admin
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (token === serviceRoleKey) {
      // Authenticated as service role (from scheduled-backup-notify) — proceed
      console.log("[sync-offsite] Authenticated via service role key");
    } else if (authHeader?.startsWith("Bearer ")) {
      // User-triggered: verify backup admin
      const sourceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claims, error: claimsErr } = await sourceClient.auth.getClaims(token!);
      if (claimsErr || !claims?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // M1: Role-based check (backup_operator) instead of hardcoded UUID
      const { data: isBackupAdmin, error: rpcError } = await sourceClient.rpc("is_backup_admin");
      if (rpcError || !isBackupAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden: backup admin only" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const backupPath = body.backup_path || body.file_path;
    if (!backupPath || typeof backupPath !== "string") {
      return new Response(
        JSON.stringify({ error: "backup_path is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[sync-offsite] Starting sync for: ${backupPath}`);
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const deadline = Date.now() + TIMEOUT_MS;

    // ── Pass 1: Sync the daily backup folder ──
    const extResult = await syncToExternalSupabase(adminClient, backupPath, deadline);

    console.log(
      `[sync-offsite] Daily folder: synced=${extResult.files_synced}, skipped=${extResult.files_skipped}, errors=${extResult.files_errored}, timed_out=${extResult.timed_out}`,
    );

    // ── Pass 2: Sync persistent pdfs/ folder (incremental) ──
    let pdfSyncResult: SyncResult | null = null;
    if (!extResult.timed_out && Date.now() < deadline) {
      console.log("[sync-offsite] Starting PDF folder sync...");
      pdfSyncResult = await syncPdfsFolder(adminClient, deadline);
      console.log(
        `[sync-offsite] PDF folder: synced=${pdfSyncResult.files_synced}, skipped=${pdfSyncResult.files_skipped}, errors=${pdfSyncResult.files_errored}, timed_out=${pdfSyncResult.timed_out}`,
      );
    }

    // Combine results
    const combinedSuccess = extResult.success && (!pdfSyncResult || pdfSyncResult.success);

    return new Response(
      JSON.stringify({
        success: combinedSuccess,
        external_supabase: extResult,
        pdf_sync: pdfSyncResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[sync-offsite] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Sync the persistent pdfs/ folder from source to external Supabase.
 * Only uploads files that don't already exist on the destination.
 */
async function syncPdfsFolder(
  sourceClient: any,
  deadline: number,
): Promise<SyncResult> {
  const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
  const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_KEY");

  if (!extUrl || !extKey) {
    return {
      success: false,
      files_synced: 0,
      files_skipped: 0,
      files_errored: 0,
      total_size_bytes: 0,
      errors: ["External Supabase not configured"],
      timed_out: false,
    };
  }

  const extClient = createClient(extUrl, extKey);
  const result: SyncResult = {
    success: true,
    files_synced: 0,
    files_skipped: 0,
    files_errored: 0,
    total_size_bytes: 0,
    errors: [],
    timed_out: false,
  };

  // List all PDFs in source
  const sourceFiles = await listAllFiles(sourceClient, "database-backups", "pdfs");
  console.log(`[sync-offsite] Found ${sourceFiles.length} PDF files in source`);

  if (sourceFiles.length === 0) return result;

  // Process in batches
  for (let i = 0; i < sourceFiles.length; i += CONCURRENCY) {
    if (Date.now() > deadline) {
      result.timed_out = true;
      console.warn("[sync-offsite] Timeout reached during PDF sync");
      break;
    }

    const batch = sourceFiles.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (file) => {
      try {
        // Check if exists on destination
        const parentPath = file.path.substring(0, file.path.lastIndexOf("/"));
        const { data: existing } = await extClient.storage
          .from("ropeworks-backups")
          .list(parentPath, { limit: 1, search: file.name });

        if (existing && existing.some((e: any) => e.name === file.name)) {
          result.files_skipped++;
          return;
        }

        // Download from source
        const { data: blob, error: dlErr } = await sourceClient.storage
          .from("database-backups")
          .download(file.path);

        if (dlErr || !blob) {
          throw new Error(`Download failed: ${dlErr?.message || "no data"}`);
        }

        // Upload to destination
        const { error: upErr } = await extClient.storage
          .from("ropeworks-backups")
          .upload(file.path, blob, {
            contentType: "application/pdf",
            upsert: false,
          });

        if (upErr) {
          throw new Error(`Upload failed: ${upErr.message}`);
        }

        result.files_synced++;
        result.total_size_bytes += file.size || (blob as Blob).size || 0;
      } catch (err: any) {
        result.files_errored++;
        if (result.errors.length < 10) {
          result.errors.push(`${file.path}: ${err.message}`);
        }
      }
    });

    await Promise.all(promises);
  }

  result.success = result.files_errored === 0 && !result.timed_out;
  return result;
}
