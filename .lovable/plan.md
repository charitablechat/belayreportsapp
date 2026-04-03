

# Remove PDF Authorization Check (G2 Fix)

## What Changes

Remove lines 53-73 from `supabase/functions/generate-inspection-pdf/index.ts` — the ownership/admin verification block that was added as the G2 fix.

This removes:
- The `inspectionOwner` lookup query
- The `inspector_id !== user.id` ownership check
- The `is_admin_or_above` RPC fallback for admins
- The "Inspection not found" and "Unauthorized" error paths

The function will retain its existing authentication (JWT validation at line 27-32) and rate limiting (lines 34-45), so only authenticated users can call it — but any authenticated user who knows an inspection ID will be able to generate its PDF.

## File

`supabase/functions/generate-inspection-pdf/index.ts` — delete lines 53-73 (the block starting with `// G2 Fix:` through the closing `}`).

