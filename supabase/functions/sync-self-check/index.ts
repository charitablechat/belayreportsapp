// sync-self-check: lightweight diagnostic endpoint that proves whether
// the caller's JWT and RLS visibility are healthy. Surfaced in the iPad
// "Sync Terminal" so users (and us) can tell a stuck JWT/RLS state apart
// from genuinely-pending work.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

interface TableProbe {
  table: string;
  ok: boolean;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ jwt_ok: false, error: "missing_bearer_token" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");

  // Step 1 — verify JWT
  let userId: string | null = null;
  let jwtOk = false;
  let jwtError: string | undefined;
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      jwtError = error?.message ?? "no_claims";
    } else {
      userId = data.claims.sub as string;
      jwtOk = true;
    }
  } catch (e) {
    jwtError = (e as Error).message;
  }

  if (!jwtOk) {
    return new Response(
      JSON.stringify({
        jwt_ok: false,
        error: jwtError ?? "jwt_invalid",
        elapsed_ms: Date.now() - startedAt,
      }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Step 2 — RLS probes (cheap HEAD-style count queries).
  const tables = [
    "inspections",
    "trainings",
    "daily_assessments",
    "inspection_photos",
    "training_photos",
    "daily_assessment_photos",
  ];
  const probes: TableProbe[] = [];
  for (const table of tables) {
    try {
      const { error } = await supabase
        .from(table)
        .select("id", { head: true, count: "exact" })
        .limit(1);
      probes.push({ table, ok: !error, error: error?.message });
    } catch (e) {
      probes.push({ table, ok: false, error: (e as Error).message });
    }
  }

  const rlsOk = probes.every((p) => p.ok);
  const clientNow = req.headers.get("x-client-now");
  let clockSkewMs: number | null = null;
  if (clientNow) {
    const parsed = Number(clientNow);
    if (Number.isFinite(parsed)) clockSkewMs = Date.now() - parsed;
  }

  return new Response(
    JSON.stringify({
      jwt_ok: true,
      user_id: userId,
      rls_ok: rlsOk,
      probes,
      clock_skew_ms: clockSkewMs,
      elapsed_ms: Date.now() - startedAt,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
