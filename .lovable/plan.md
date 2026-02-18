
# Data Persistence and Recovery: Fix Perpetual Re-Sync Race Condition

## Root Cause Confirmed

The `update_updated_at_column` database trigger **unconditionally** sets `updated_at = NOW()` on every UPDATE, including the final sync step that sets `synced_at`. This creates a permanent ~500ms drift where `updated_at > synced_at` on the server.

**Evidence**: Every single synced record across all three tables shows `appears_unsynced = true`:
- Inspections: Druidia (2.4s drift), Twin Lakes YMCA (547ms), Camp of the Hills (1.8s)
- Trainings: Cal Farley's (456ms), Camp of the Hills (1.7s)
- Daily Assessments: Cloud City (367ms), Mango Tractor (334ms)

**Consequence chain**:
1. Sync completes, `synced_at` is set on server
2. Trigger bumps `updated_at` to ~500ms later
3. Dashboard fetches from server: `updated_at > synced_at`
4. `getUnsyncedInspections()` picks it up again
5. Re-sync loop repeats every 30-60 seconds, wasting bandwidth and battery

The v2.5.8 client-side fix (fetching `updated_at` and aligning locally) only fixes the **local** IndexedDB state. The **server** still has misaligned timestamps, so every Dashboard reload re-flags these records as unsynced.

---

## Fix 1: Database Trigger (Root Cause)

Modify the `update_updated_at_column` trigger to skip bumping `updated_at` when the only columns changing are sync/metadata fields (`synced_at`, `last_opened_at`, `last_modified_by`, `latest_report_generated_at`, `latest_report_html`).

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip bumping updated_at when only sync/metadata fields changed
  -- This prevents the synced_at UPDATE from creating timestamp drift
  IF TG_OP = 'UPDATE' AND
     OLD.synced_at IS DISTINCT FROM NEW.synced_at AND
     ROW(NEW.*) IS NOT DISTINCT FROM ROW(
       OLD.* -- all old values
     )
  THEN
    -- Can't use ROW comparison easily, so check key data fields
    -- If synced_at changed but nothing else meaningful did, preserve old updated_at
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$function$;
```

Since `ROW()` comparison is impractical across varying table schemas, the cleaner approach is: **always set `synced_at` to match the trigger's `NOW()`**. Instead of the client sending a timestamp, use a SQL expression:

**Revised approach**: After the transaction, run a single UPDATE that sets `synced_at = updated_at` to align the two fields. This eliminates drift without modifying the trigger.

```sql
-- One-time fix for all existing records
UPDATE inspections SET synced_at = updated_at WHERE synced_at IS NOT NULL AND updated_at > synced_at;
UPDATE trainings SET synced_at = updated_at WHERE synced_at IS NOT NULL AND updated_at > synced_at;
UPDATE daily_assessments SET synced_at = updated_at WHERE synced_at IS NOT NULL AND updated_at > synced_at;
```

## Fix 2: Atomic Sync Manager -- Server-Side Alignment

**File: `src/lib/atomic-sync-manager.ts`**

After the transaction completes, add a **post-sync alignment step** that sets `synced_at = updated_at` on the server, then fetches the aligned timestamps for local storage.

For inspections (line ~419-460), trainings (line ~965-1003), and daily assessments (same pattern):

Replace the current final transaction step + post-sync fetch with:

```typescript
// FINAL STEP: Set synced_at = NOW() (trigger will also set updated_at = NOW())
steps.push({
  table: 'inspections',
  operation: 'update',
  data: { synced_at: new Date().toISOString() },
  filter: { id: inspectionId },
});

// Execute transaction
const result = await executeTransaction(steps);

// POST-SYNC ALIGNMENT: Set synced_at = updated_at on server to eliminate trigger drift
// Then fetch the aligned timestamp for local storage
let serverTimestamp: string;
try {
  // Align server-side: synced_at = updated_at (single atomic UPDATE)
  await supabase
    .from('inspections')
    .update({ synced_at: new Date().toISOString() }) // This triggers updated_at bump
    .eq('id', inspectionId);
  
  // Fetch the final aligned state
  const { data: serverRecord } = await supabase
    .from('inspections')
    .select('updated_at, synced_at')
    .eq('id', inspectionId)
    .single();
  
  // Use the server's updated_at (which is always >= synced_at due to trigger)
  // Set local synced_at = server updated_at to guarantee synced_at >= updated_at locally
  serverTimestamp = serverRecord?.updated_at || new Date().toISOString();
} catch {
  serverTimestamp = new Date().toISOString();
}

await saveInspectionOffline({
  ...inspection,
  synced_at: serverTimestamp,
  updated_at: serverTimestamp,
  // ...
});
```

Wait -- this still has the same problem. The second UPDATE also triggers `updated_at` bump.

**Correct approach**: Use a raw SQL RPC that sets `synced_at = updated_at` in a single statement without re-triggering:

Create a database function:
```sql
CREATE OR REPLACE FUNCTION public.align_synced_at(
  p_table_name text,
  p_record_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result_row record;
BEGIN
  IF p_table_name = 'inspections' THEN
    UPDATE inspections SET synced_at = updated_at WHERE id = p_record_id
    RETURNING updated_at, synced_at INTO result_row;
  ELSIF p_table_name = 'trainings' THEN
    UPDATE trainings SET synced_at = updated_at WHERE id = p_record_id
    RETURNING updated_at, synced_at INTO result_row;
  ELSIF p_table_name = 'daily_assessments' THEN
    UPDATE daily_assessments SET synced_at = updated_at WHERE id = p_record_id
    RETURNING updated_at, synced_at INTO result_row;
  ELSE
    RETURN jsonb_build_object('error', 'Invalid table name');
  END IF;
  
  RETURN jsonb_build_object(
    'updated_at', result_row.updated_at,
    'synced_at', result_row.synced_at
  );
END;
$$;
```

But wait -- the trigger STILL fires. The solution is to modify the trigger itself to not bump `updated_at` when ONLY `synced_at` changes. This is the cleanest approach:

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip bumping updated_at when ONLY synced_at or last_opened_at changed
  -- This prevents the post-sync alignment step from creating new drift
  IF TG_OP = 'UPDATE' THEN
    -- Create copies with sync/metadata fields normalized to detect if anything else changed
    DECLARE
      old_compare jsonb;
      new_compare jsonb;
    BEGIN
      old_compare = to_jsonb(OLD) - 'updated_at' - 'synced_at' - 'last_opened_at' - 'last_modified_by' - 'latest_report_generated_at' - 'latest_report_html' - 'report_version';
      new_compare = to_jsonb(NEW) - 'updated_at' - 'synced_at' - 'last_opened_at' - 'last_modified_by' - 'latest_report_generated_at' - 'latest_report_html' - 'report_version';
      
      IF old_compare = new_compare THEN
        -- Only metadata fields changed -- preserve existing updated_at
        NEW.updated_at = OLD.updated_at;
        RETURN NEW;
      END IF;
    END;
  END IF;
  
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
```

Then update the atomic sync manager to:
1. Keep the final `synced_at` step as-is
2. After transaction, call `align_synced_at` RPC to set `synced_at = updated_at`
3. Fetch aligned timestamps for local storage

Actually, with the trigger fix, the problem is solved directly: when the final step sets `synced_at`, the trigger sees only `synced_at` changed and preserves `updated_at`. So `synced_at` will be the client timestamp, and `updated_at` stays at whatever it was before. Then the client fetches `updated_at` and sets both locally. Since `updated_at` didn't change, there's no drift.

But we still want `synced_at >= updated_at` on the server. So the post-sync step should set `synced_at = updated_at` (which the trigger will allow without bumping `updated_at`).

**Final approach -- two database changes + client-side update**:

### Database Migration

1. Update trigger to skip `updated_at` bump for metadata-only changes
2. Align all existing records: `SET synced_at = updated_at`
3. Create `align_synced_at` RPC for post-sync alignment

### Client-Side Changes

**File: `src/lib/atomic-sync-manager.ts`**

For all three report types (inspections, trainings, daily assessments):

Replace the post-sync timestamp fetch with a call to `align_synced_at` RPC:

```typescript
// After executeTransaction succeeds:
let serverTimestamp: string;
try {
  const { data: aligned } = await supabase.rpc('align_synced_at', {
    p_table_name: 'inspections',
    p_record_id: inspectionId,
  });
  serverTimestamp = (aligned as any)?.updated_at || new Date().toISOString();
} catch {
  serverTimestamp = new Date().toISOString();
}

await saveInspectionOffline({
  ...inspection,
  synced_at: serverTimestamp,
  updated_at: serverTimestamp,
  inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
});
```

This replaces the current fetch at lines 438-460 (inspections), 984-1003 (trainings), and the equivalent in daily assessments.

---

## Fix 3: Pending Uploads Chip

**File: `src/components/dashboard/ReportCard.tsx`**

The existing "Local" badge (line 228-231) already shows when `synced_at` is null. Enhance it with the pending count from the SyncPulse context.

No changes needed -- the existing SyncPulse component and ReportCard badges already cover this. The perpetual re-sync fix will make the badges accurate.

## Fix 4: Stale Upload Warning

Already implemented in `useAutoSync.tsx` at lines 511-535. The `STALE_UPLOAD_THRESHOLD` of 5 minutes and `STALE_CHECK_INTERVAL` of 60 seconds are correctly configured. The toast warning fires when items haven't synced for 5+ minutes while online.

No changes needed.

## Fix 5: Retro-Tech Terminal Aesthetic for Sync Logs

**File: `src/components/pwa/SyncPulse.tsx`**

Restyle the sync status sheet with a retro-tech terminal look:
- Monospaced font (JetBrains Mono via Google Fonts, falling back to `font-mono`)
- Green-on-dark color scheme for the status sheet
- CRT scanline overlay effect via CSS
- Blinking cursor animation for active sync processes
- Retro-styled badges for "SYNCED" and "PENDING" states

**File: `src/index.css`**

Add the CRT scanline overlay and blinking cursor keyframes:
```css
@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.crt-scanlines::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  );
  pointer-events: none;
}
```

---

## Summary of Changes

| File | Change |
|------|--------|
| **Database migration** | Update `update_updated_at_column` trigger; create `align_synced_at` RPC; align all existing records |
| `src/lib/atomic-sync-manager.ts` | Replace post-sync timestamp fetch with `align_synced_at` RPC call (3 locations: inspections, trainings, daily assessments) |
| `src/components/pwa/SyncPulse.tsx` | Retro-tech terminal styling for sync status sheet |
| `src/index.css` | CRT scanline overlay and blinking cursor animations |

## Risk Assessment

- **Trigger change**: Low risk. The trigger still bumps `updated_at` for all real data changes. Only metadata-only updates are excluded. The JSONB comparison is schema-agnostic and works across all tables.
- **RPC function**: Low risk. SECURITY DEFINER with explicit table allowlist. Only sets `synced_at = updated_at`, never modifies data.
- **One-time data fix**: Zero data loss. Only sets `synced_at = updated_at` for already-synced records, making them correctly appear as synced.
- **Client changes**: Low risk. Replaces a SELECT with an RPC call that does the same thing plus alignment.
