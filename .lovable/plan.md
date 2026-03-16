

## Photo Visibility Safeguards

### Root Cause Analysis

I verified the database and storage policies. Key findings:

- Brenda, Josh, and you (Kale) are all `super_admin` — so table-level and storage-level RLS policies **should** grant access
- The Camp Balcones photos exist in storage (uploaded by Luke)
- The `inspection_photos` table SELECT policy for super admins is correct
- The storage SELECT policy for `inspection-photos` bucket for super admins is correct

**Most likely cause**: When `createSignedUrl` fails (network glitch, session timeout, transient auth issue), the code returns `null` and **silently filters out the photo** — the user sees an empty gallery with no explanation. There's also a missing storage SELECT policy for photo **owners**, meaning non-super-admin users can never view their own photos.

### Plan

**1. Add missing storage SELECT policy for photo owners**
Currently owners can upload and delete their own photos but there's no policy letting them **read** them. This means non-super-admin users (like Luke, Taylor) can never see their own photos. Add owner-based SELECT policies for all three photo buckets:
- `inspection-photos`: SELECT WHERE `auth.uid()::text = storage.foldername(name)[1]`
- `training-photos`: same pattern (currently only super_admin ALL exists)
- `daily-assessment-photos`: same pattern

**2. Show failed-to-load warning in PhotoGallery** (`src/components/PhotoGallery.tsx`)
Instead of silently filtering out photos when `createSignedUrl` fails:
- Track a `failedCount` state
- When photos fail to generate signed URLs, increment the counter
- Display a warning banner: "X photo(s) could not be loaded. Try refreshing or check your connection."
- This ensures users know photos exist but couldn't be displayed, rather than seeing an empty gallery

**3. Add console logging for photo access diagnostics**
Enhance the error logging in `createSignedUrl` failures to include the storage path and bucket name, making it easier to diagnose future issues without guessing.

### Changes Summary

| What | Where |
|------|-------|
| 3 new storage SELECT policies (owner access) | SQL migration |
| Failed photo warning banner + state tracking | `src/components/PhotoGallery.tsx` |
| Enhanced error logging | `src/components/PhotoGallery.tsx` |

