

## Make Onboarding Read-Only and Seed Admin Manual

The `/onboarding` route and `onboarding_resources` table are already restricted to admin/super_admin roles. No database or RLS changes needed.

### Changes

**1. `src/pages/Onboarding.tsx` — Strip all upload/management UI**
- Remove: `addDialogOpen`, `newTitle`, `newDescription`, `newFileType`, `newFile`, `uploading` state variables
- Remove: `handleUpload` function, `togglePublish` mutation, `deleteResource` mutation
- Remove: "Add Resource" dialog and trigger button from the header
- Remove: publish/unpublish and delete buttons from `ResourceCard`
- Remove: unused imports (`Plus`, `Upload`, `Input`, `Label`, `Textarea`, `Select*`, `Dialog` for add form, `Eye`, `EyeOff`, `Trash2`, `Badge`)
- Keep: `useRequireAdmin` guard, progress tracking, video player, `getSignedUrl`, `handleResourceClick`, completion toggle

**2. Seed the Admin Manual PDF into the database**
- Upload `02_Admin_Super_Admin_Manual_1.pdf` to the `onboarding-files` storage bucket
- Insert a row into `onboarding_resources`: title "Admin & Super Admin Manual", file_type "pdf", is_published true, display_order 0

### What stays the same
- `useRequireAdmin` hook blocks all non-admin users and redirects to `/dashboard`
- RLS on `onboarding_resources` requires `is_admin_or_above()` for SELECT
- RLS on `onboarding_progress` scoped to authenticated user's own rows
- Progress bar and completion checkboxes

