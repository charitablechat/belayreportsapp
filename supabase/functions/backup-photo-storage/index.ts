import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PHOTO_BUCKETS = [
  "inspection-photos",
  "training-photos",
  "daily-assessment-photos",
] as const;

// Photo metadata tables matching each bucket
const PHOTO_TABLES: Record<string, string> = {
  "inspection-photos": "inspection_photos",
  "training-photos": "training_photos",
  "daily-assessment-photos": "daily_assessment_photos",
};

const CONCURRENCY_LIMIT = 5;
const TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes safety valve

interface CopyResult {
  bucket: string;
  path: string;
  size: number;
  skipped: boolean;
  error?: string;
}

interface PhotoBackupResult {
  total_copied: number;
  total_skipped: number;
  total_errors: number;
  total_size_bytes: number;
  timed_out: boolean;
  buckets: Record<string, { copied: number; skipped: number; errors: number; size: number }>;
  errors: Array<{ bucket: string; path: string; error: string }>;
}

/**
 * Fetch the set of photo_url paths that are soft-deleted (deleted_at IS NOT NULL).
 * Returns a Set of storage paths (the part after the bucket prefix).
 */
async function getSoftDeletedPaths(supabase: any, table: string): Promise<Set<string>> {
  const deleted = new Set<string>();
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("photo_url")
      .not("deleted_at", "is", null)
      .range(from, from + batchSize - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      if (row.photo_url) {
        // Extract the storage path from the URL
        const path = extractStoragePath(row.photo_url);
        if (path) deleted.add(path);
      }
    }
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return deleted;
}

/**
 * Extract the storage path from a full Supabase storage URL.
 * e.g. ".../storage/v1/object/public/inspection-photos/abc/photo.jpg" → "abc/photo.jpg"
 * or just "abc/photo.jpg" if already a relative path.
 */
function extractStoragePath(url: string): string {
  if (!url) return "";
  // Already a relative path (no scheme) → return as-is
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    // Storage URLs: /storage/v1/object/{public|authenticated|sign}/{bucket}/{path}
    const parts = u.pathname.split("/").filter(Boolean);
    const objIdx = parts.indexOf("object");
    if (objIdx === -1) return "";
    // Skip "object" + access-mode (public/authenticated/sign) → bucket index
    const bucketIdx = objIdx + 2;
    if (parts.length <= bucketIdx + 1) return "";
    const bucket = parts[bucketIdx];
    if (!PHOTO_BUCKETS.includes(bucket as any)) return "";
    return parts.slice(bucketIdx + 1).join("/");
  } catch {
    return "";
  }
}

/**
 * List all files in a storage bucket, paginated.
 */
async function listAllFiles(
  supabase: any,
  bucket: string,
  prefix: string = "",
): Promise<Array<{ name: string; metadata?: { size?: number } }>> {
  const allFiles: Array<{ name: string; metadata?: { size?: number } }> = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });

    if (error) {
      console.warn(`[backup-photo-storage] Error listing ${bucket}/${prefix}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;

    // Filter out folders (they have id = null and no metadata)
    for (const item of data) {
      if (item.id) {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        allFiles.push({ name: fullPath, metadata: item.metadata });
      } else {
        // It's a folder — recurse
        const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
        const subFiles = await listAllFiles(supabase, bucket, subPrefix);
        allFiles.push(...subFiles);
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return allFiles;
}

/**
 * Copy a single file from source bucket to backup bucket.
 */
async function copyFile(
  supabase: any,
  sourceBucket: string,
  sourcePath: string,
  destBucket: string,
  destPath: string,
): Promise<CopyResult> {
  try {
    // Check if destination already exists
    const { data: existing } = await supabase.storage
      .from(destBucket)
      .list(destPath.substring(0, destPath.lastIndexOf("/")), {
        limit: 1,
        search: destPath.substring(destPath.lastIndexOf("/") + 1),
      });

    if (existing && existing.length > 0 && existing.some((f: any) =>
      f.name === destPath.substring(destPath.lastIndexOf("/") + 1)
    )) {
      return { bucket: sourceBucket, path: sourcePath, size: 0, skipped: true };
    }

    // Download from source
    const { data: blob, error: dlError } = await supabase.storage
      .from(sourceBucket)
      .download(sourcePath);

    if (dlError) {
      return { bucket: sourceBucket, path: sourcePath, size: 0, skipped: false, error: dlError.message };
    }

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Upload to backup
    const { error: ulError } = await supabase.storage
      .from(destBucket)
      .upload(destPath, bytes, {
        contentType: blob.type || "application/octet-stream",
        upsert: false,
      });

    if (ulError) {
      // If duplicate, treat as skipped
      if (ulError.message?.includes("already exists") || ulError.statusCode === 409) {
        return { bucket: sourceBucket, path: sourcePath, size: 0, skipped: true };
      }
      return { bucket: sourceBucket, path: sourcePath, size: 0, skipped: false, error: ulError.message };
    }

    return { bucket: sourceBucket, path: sourcePath, size: bytes.length, skipped: false };
  } catch (err: any) {
    return { bucket: sourceBucket, path: sourcePath, size: 0, skipped: false, error: err.message };
  }
}

/**
 * Process items in batches with concurrency limit.
 */
async function processBatched<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  shouldStop: () => boolean,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    if (shouldStop()) break;
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    // Parse request body for the backup timestamp/path
    const body = await req.json().catch(() => ({}));
    const backupTimestamp = body.timestamp || new Date().toISOString().replace(/[:.]/g, "-");

    console.log(`[backup-photo-storage] Starting photo backup to daily/${backupTimestamp}/photos/`);

    const startTime = Date.now();
    const shouldStop = () => (Date.now() - startTime) > TIMEOUT_MS;

    const result: PhotoBackupResult = {
      total_copied: 0,
      total_skipped: 0,
      total_errors: 0,
      total_size_bytes: 0,
      timed_out: false,
      buckets: {},
      errors: [],
    };

    for (const bucket of PHOTO_BUCKETS) {
      if (shouldStop()) {
        result.timed_out = true;
        console.warn(`[backup-photo-storage] Timeout reached, stopping after ${bucket}`);
        break;
      }

      console.log(`[backup-photo-storage] Processing bucket: ${bucket}`);

      const bucketStats = { copied: 0, skipped: 0, errors: 0, size: 0 };
      result.buckets[bucket] = bucketStats;

      // Get soft-deleted photo paths to exclude
      const table = PHOTO_TABLES[bucket];
      const deletedPaths = table ? await getSoftDeletedPaths(adminClient, table) : new Set<string>();
      console.log(`[backup-photo-storage] ${bucket}: ${deletedPaths.size} soft-deleted photos to skip`);

      // List all files in bucket
      const files = await listAllFiles(adminClient, bucket);
      console.log(`[backup-photo-storage] ${bucket}: ${files.length} files found`);

      // Filter out soft-deleted files
      const activeFiles = files.filter(f => !deletedPaths.has(f.name));
      console.log(`[backup-photo-storage] ${bucket}: ${activeFiles.length} active files to back up`);

      // Copy files in batches
      const copyResults = await processBatched(
        activeFiles,
        CONCURRENCY_LIMIT,
        (file) => copyFile(
          adminClient,
          bucket,
          file.name,
          "database-backups",
          `daily/${backupTimestamp}/photos/${bucket}/${file.name}`,
        ),
        shouldStop,
      );

      for (const cr of copyResults) {
        if (cr.skipped) {
          bucketStats.skipped++;
          result.total_skipped++;
        } else if (cr.error) {
          bucketStats.errors++;
          result.total_errors++;
          if (result.errors.length < 20) {
            result.errors.push({ bucket: cr.bucket, path: cr.path, error: cr.error });
          }
        } else {
          bucketStats.copied++;
          bucketStats.size += cr.size;
          result.total_copied++;
          result.total_size_bytes += cr.size;
        }
      }

      console.log(
        `[backup-photo-storage] ${bucket}: copied=${bucketStats.copied}, skipped=${bucketStats.skipped}, errors=${bucketStats.errors}, size=${formatFileSize(bucketStats.size)}`
      );
    }

    if (shouldStop() && !result.timed_out) {
      result.timed_out = true;
    }

    console.log(
      `[backup-photo-storage] Complete: copied=${result.total_copied}, skipped=${result.total_skipped}, errors=${result.total_errors}, size=${formatFileSize(result.total_size_bytes)}, timed_out=${result.timed_out}`
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[backup-photo-storage] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
