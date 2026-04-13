

# Fix: Off-Site Backup Sync Not Running

## Root Cause

The `sync-offsite-backup` edge function has an authentication bug that silently rejects calls from `scheduled-backup-notify`.

**The problem** (lines 172-193 of `sync-offsite-backup/index.ts`):

When `scheduled-backup-notify` calls `sync-offsite-backup`, it passes `Authorization: Bearer ${serviceRoleKey}`. The sync function sees a Bearer token and tries to validate it as a **user JWT** via `getClaims()`. The service role key is not a user JWT — `getClaims` fails — and the function returns **401 Unauthorized**. The caller logs the error as a non-fatal warning and continues, so the backup email still sends but off-site sync silently fails every night.

The comment on line 193 says "Also allow service-role calls (from scheduled-backup-notify)" but the code never actually implements that bypass — it only falls through if there's **no** Bearer token at all.

## Evidence

- `backup_history` shows daily backups running successfully (most recent: 2026-04-13)
- Edge function logs for `sync-offsite-backup` are **completely empty** — the function is being called but returning 401 before doing any real work
- The `scheduled-backup-notify` function catches the error at line 587 and continues

## Fix

Update `sync-offsite-backup/index.ts` to detect when the Authorization header contains the service role key and skip user JWT validation in that case:

```typescript
// Lines 172-193 — replace auth block
const authHeader = req.headers.get("Authorization");
const token = authHeader?.replace("Bearer ", "");

// Allow service-role calls (from scheduled-backup-notify orchestrator)
if (token === serviceRoleKey) {
  // Authenticated as service role — proceed
} else if (authHeader?.startsWith("Bearer ")) {
  // User-triggered: verify backup admin
  const sourceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimsErr } = await sourceClient.auth.getClaims(token!);
  if (claimsErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (claims.claims.sub !== "759e973e-2484-4db3-862a-0cb2ec6d6ea3") {
    return new Response(JSON.stringify({ error: "Forbidden: backup admin only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
} else {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

## Files to Update

1. **`supabase/functions/sync-offsite-backup/index.ts`** — Fix auth bypass for service role key

## Deployment

Deploy `sync-offsite-backup` after the fix. The next nightly run (midnight UTC) will automatically pick it up.

