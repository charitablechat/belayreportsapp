

## Onboarding Resource Center

A dedicated `/onboarding` page where users can browse videos and PDFs you've uploaded, and mark items as completed.

### Database

**1. `onboarding_resources` table** — stores metadata for each uploaded file

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| title | text | Display name |
| description | text | Optional summary |
| file_type | text | 'video' or 'pdf' |
| file_url | text | Storage path |
| display_order | integer | Sort order |
| is_published | boolean | Only published items shown to users |
| uploaded_by | uuid | References auth.users |
| created_at | timestamptz | |

RLS: Super admins can CRUD. Authenticated users can SELECT where `is_published = true`.

**2. `onboarding_progress` table** — tracks per-user completion

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | References auth.users |
| resource_id | uuid | FK to onboarding_resources |
| completed_at | timestamptz | When marked complete |
| unique(user_id, resource_id) | | Prevents duplicates |

RLS: Users can manage their own rows only.

**3. `onboarding-files` storage bucket** — private bucket for the actual video/PDF files. Super admins can upload; authenticated users can read.

### Frontend

**`/onboarding` page** — accessible from the dashboard header navigation:
- Lists all published resources grouped by type (Videos section, Documents section)
- Each card shows: title, description, file type icon, and a checkbox to mark complete
- Clicking a video opens an inline `<video>` player; clicking a PDF downloads it
- A progress bar at the top shows "X of Y completed"
- Matches existing app styling (cards, borders, monospace metadata)

**Admin upload UI** — visible only to super admins on the same page:
- "Add Resource" button opens a form: title, description, file type selector, file upload input, display order
- Drag-to-reorder support using existing drag patterns
- Toggle publish/unpublish per resource
- Delete resource (removes from storage + DB)

### Route Addition

Add `/onboarding` to `App.tsx` router, import the new `Onboarding.tsx` page component. Add a navigation link in `AuthenticatedHeader.tsx`.

### Files

| File | Action |
|------|--------|
| Migration SQL | Create tables, bucket, RLS policies |
| `src/pages/Onboarding.tsx` | New page component |
| `src/App.tsx` | Add route |
| `src/components/AuthenticatedHeader.tsx` | Add nav link |

