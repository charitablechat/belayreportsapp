

## Fix "Failed to Upload Photo" Error

### Root Cause

The upload uses `upsert: true` which internally performs an **UPDATE** when the file already exists. However, there is **no UPDATE policy** on `storage.objects` for the `inspection-photos` bucket. Even on first upload, Supabase's upsert path may check UPDATE permissions, causing RLS violations.

Additionally, there are **duplicate/redundant INSERT policies** (3 INSERT policies exist), which isn't harmful but adds confusion.

### Plan

**1. Database Migration — Add missing UPDATE policy**

Add an UPDATE policy for `inspection-photos` so `upsert: true` works:

```sql
CREATE POLICY "Users can update their own inspection photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'inspection-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'inspection-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
```

Also clean up the duplicate INSERT policy "Authenticated users can upload inspection photos" (the one with no folder check), which is overly permissive:

```sql
DROP POLICY IF EXISTS "Authenticated users can upload inspection photos" ON storage.objects;
```

**2. Improve error logging in `ItemPhotoUpload.tsx`**

Add more specific error details to the console log and toast so users/developers can identify the exact failure (auth vs RLS vs network):

```typescript
} catch (err: any) {
  console.error("[ItemPhotoUpload] Upload failed:", err);
  const message = err?.message || err?.statusCode === '403' 
    ? "Permission denied - please try logging out and back in"
    : "Failed to upload photo";
  toast.error(message);
}
```

### Files affected

| File | Change |
|------|--------|
| New migration SQL | Add UPDATE policy, remove overly permissive INSERT policy |
| `src/components/inspection/ItemPhotoUpload.tsx` | Better error messaging |

### Chatbot note
The chatbot 403 error (`platform.aminos.ai` — "Referring domain not in whitelist") is completely unrelated to photo uploads. It's a third-party service domain whitelist issue, not a shared dependency or security context conflict.

