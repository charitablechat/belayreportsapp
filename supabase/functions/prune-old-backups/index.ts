// Prune old daily backup objects from the `database-backups` storage bucket.
// Authed via x-webhook-secret (matching export-full-backup pattern).
// Retention rule: keep daily/* backups from the last 14 days; delete the rest.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const storedWebhookSecret = Deno.env.get("WEBHOOK_SECRET");
    const webhookSecret = req.headers.get("x-webhook-secret");

    if (!storedWebhookSecret || webhookSecret !== storedWebhookSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Pull candidates directly from storage.objects via RPC-free query is not
    // available on the JS client; fall back to list() pagination instead.
    const toDelete: string[] = [];
    const limit = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage
        .from("database-backups")
        .list("daily", { limit, offset, sortBy: { column: "created_at", order: "asc" } });
      if (error) throw new Error(`list daily/ failed: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const obj of data) {
        if (!obj.created_at) continue;
        if (new Date(obj.created_at) < cutoff) {
          toDelete.push(`daily/${obj.name}`);
        }
      }
      if (data.length < limit) break;
      offset += data.length;
    }

    // Delete in batches of 500 (storage API limit is generous, but keep modest).
    let deleted = 0;
    const batchSize = 500;
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      const { error } = await admin.storage.from("database-backups").remove(batch);
      if (error) {
        console.error(`batch remove failed at ${i}: ${error.message}`);
        // continue with next batch
      } else {
        deleted += batch.length;
      }
    }

    // Best-effort: trim corresponding backup_history rows.
    await admin
      .from("backup_history")
      .delete()
      .lt("created_at", cutoff.toISOString())
      .like("file_path", "daily/%");

    return new Response(
      JSON.stringify({
        success: true,
        candidates: toDelete.length,
        deleted,
        cutoff: cutoff.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("prune-old-backups error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
