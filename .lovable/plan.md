## Rebrand: Rope Works → Belay Reports

Full rename across UI, reports, PDFs, emails, OG/meta, offline DB, backups, and password blocklist. New logos replace `rope-works-logo.*` everywhere. Sentry issue IDs and test descriptions that reference old strings stay as-is (historical, not user-visible).

### 1. Logos (assets)

Upload the three GIFs to the Lovable asset CDN, plus extract a static PNG of the stacked logo's first frame for PDF/HTML reports (animation isn't possible in PDFs).

- `shimmer_wide_logo.gif` → wide logo, used in: Auth sign-in (already), AuroraLanding header, Capabilities header, Dashboard header, Profile header, NewInspection / NewTraining / NewDailyAssessment headers, Install page, InspectionHeaderSection, TrainingHeaderSection, DailyAssessmentForm header, App.tsx "Open offline" splash, `public/offline.html`, PWA install banner.
- `shimmer_pronounced.gif` → square mark, used for: favicon (`/favicon.ico` + `apple-touch-icon`), PWA manifest icons, OG meta fallback small badge, PhotoCapture splash (if any).
- `shimmer_stacked_logo.gif` → stacked, used for: PDF/HTML report headers (after extracting first frame to `belay-reports-stacked.png`), OG image card.

Static PDF logo:
- Extract frame 1 of `shimmer_stacked_logo.gif` → `belay-reports-logo-embedded.png`.
- Upload to the public `pdf-templates` storage bucket replacing the current `rope-works-logo-embedded.png` reference.
- Update `supabase/functions/get-logo-base64/index.ts` and `supabase/functions/_shared/report-layout.ts` to fetch the new file and rename the `ropeWorks` field to `belayReports` (function signatures + callers updated together).
- Delete old `src/assets/rope-works-logo.png`, `public/rope-works-logo.avif`, `public/temp-rope-works-logo.png`, and the temp/final variants in `src/assets/`. Update `src/lib/image-optimizer.ts` config key `ropeWorks` → `belayReports` with the new dimensions if needed.

### 2. Text rename

User-visible strings across `src/`, `supabase/functions/`, `index.html`, `public/offline.html`, `public/sw-offline-navigation.js`:

- `Rope Works Inc.` / `Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620` → `Belay Reports`.
- `Rope Works` → `Belay Reports`.
- `Rope Works Inspection` (page title) → `Belay Reports`.
- `RopeWorks` (in `geolocation.ts` User-Agent and `sync-diagnostic-probe` header) → `BelayReports`.
- `ROPE WORKS DIGITAL INSPECTION PLATFORM` (OG image) → `BELAY REPORTS DIGITAL INSPECTION PLATFORM`.
- `ropeworks.lovable.app` placeholder strings → `belayreports.com` (keeps consistency with existing `notify.belayreports.com`).
- File-name prefixes in saved exports/backups: `ropeworks-backup-*` → `belayreports-backup-*`, `ropeworks-full-backup-*` → `belayreports-full-backup-*`, `RopeWorks_<section>_<ts>.jpg` photo names → `BelayReports_<section>_<ts>.jpg`. (Old backups already on disk keep their original names — only new files use the new prefix.)
- BroadcastChannel name `ropeworks-restore-lock-v1` → `belayreports-restore-lock-v1` (cross-tab only; no persistence impact).
- Password blocklist (`admin-manage-user/index.ts` + `password-strength.ts`): add `belayreports`, `belayreports123`; keep `ropeworks`, `ropeworks123` so users with old weak passwords are still blocked.
- `index.html` `<title>`, `og:title`, `apple-mobile-web-app-title`, author, preload `<link>` to new wide logo path.
- `public/offline.html` title, h1, alt text, logo `<img src>`.
- `public/sw-offline-navigation.js` inline fallback HTML title/h1.

What stays unchanged (historical / non-user-facing):
- Sentry issue tags (`ROPEWORKS-68`, `ROPEWORKS-6D`, `ROPEWORKS-A`) in comments and test names — they reference the Sentry tracker, renaming would break links.
- `kale@belayreports.com` and `brendareed@ropeworks.com` user records (real emails — not the app's brand name).
- Migration file 20251109201913 SQL string (already executed; touching the file would re-run logic).
- `node_modules/`, `.git/`, lockfiles.

### 3. Emails

- `from` addresses in `send-report-email`, `send-training-pdf-email`, `check-overdue-reports`, `scheduled-backup-notify`: change display name `Rope Works` → `Belay Reports`. Keep current send domains:
  - `notify.belayreports.com` and `mail.belayreports.com` (already verified per memory) — no DNS change required.
  - Sandbox `onboarding@resend.dev` / `reports@resend.dev` entries flip to `noreply@mail.belayreports.com` to match the rest of the system.
- HTML template signatures: `Rope Works Inc. - Professional Inspection Services` → `Belay Reports — Professional Inspection Services` (em dash to match brand style).
- `auth-email-hook/index.ts` `SITE_NAME` constant `ropeworks` → `belayreports`.
- `send-transactional-email/index.ts` `SITE_NAME` constant likewise.
- `backup-notification.tsx` `SITE_NAME` + subject prefix `Ropeworks Daily Backup` → `Belay Reports Daily Backup`.
- `og-meta/index.ts` `og:site_name` + title + redirect copy.

### 4. IndexedDB rename + migration (HIGH RISK — handled carefully)

Old: `rope-works-inspections`. New: `belay-reports-inspections`. One-time, idempotent, runs once per device on first load of the rebranded app.

```
src/lib/offline-db-migrate-name.ts (NEW)
  migrateDBNameOnce():
    if localStorage['db-renamed-v1'] === '1': return
    if 'belay-reports-inspections' exists with data: mark done, return
    if 'rope-works-inspections' does not exist: mark done, return
    Acquire restore-lock (BroadcastChannel) to block sync/recovery
    Open old DB → enumerate all object stores
    Open new DB at SAME version, same schema (reuse the v19 upgrade ladder)
    Copy every record store-by-store inside a single readonly→readwrite txn pair, preserving keys
    Validate counts match
    Set localStorage['db-renamed-v1'] = '1'
    Schedule deletion of old DB after 30 days (write a tombstone with deleteAfter timestamp;
      a separate boot check deletes only after the window elapses, so a user can roll back
      by reverting localStorage flag if needed)
    Release lock
```

Call site: `src/main.tsx` (before React renders, after `db-config.js` loads). On failure, leave the old DB intact, surface a toast, and let the user keep using the old name — no destructive fallback.

Update every consumer to read from a single constant:

- `src/lib/offline-storage.ts`: `IDB_DB_NAME = 'belay-reports-inspections'`, plus the 4 hard-coded occurrences inside that file.
- `src/lib/empty-local-conflict-store.ts`, `src/lib/regression-skip-store.ts`, `src/lib/hard-reset-database.ts`, `src/lib/last-known-account.ts` (`rope-works-meta` → `belay-reports-meta` with the same one-time copy).
- `public/db-config.js` `name` field.
- Tests under `src/lib/__tests__/*` that hard-code `rope-works-inspections` → import from the shared constant or update the literal. Test descriptions stay (historical names).

Storage path orphans memory (mem://constraints/post-migration-storage-orphans) applies — old `rope-works-inspections` DB is left untouched for 30 days, then deleted. No user-data loss.

### 5. Memory + index updates

- Update `mem://index.md` Core: change "kale@belayreports.com" line unchanged (already brand-aligned); add a new memory: `mem://features/brand-belay-reports` documenting the rename, new logo locations, and the IDB v1 migration flag.
- Update existing memories that mention `rope-works-inspections` in their bodies (read-only edit to the body text, not the path).

### 6. Out of scope (will NOT touch this turn)

- Custom domain DNS, Supabase project name, Resend account name.
- Renaming the Lovable project itself.
- Storage buckets (none are named `ropeworks-*` in the current project — the `sync-offsite-backup` `ropeworks-backups` string targets an external R2 bucket; will leave that string alone and surface a note in the completion report so the owner can decide whether to rename the external bucket).
- Sentry issue tracker IDs and historical test names.

### Technical execution order

1. Upload 3 GIFs via `lovable-assets create`; extract stacked frame-1 PNG via `ffmpeg`; upload PNG to `pdf-templates` bucket.
2. Add new IDB-rename migration module + wire it into `main.tsx`.
3. Sweep text replacements across files listed above (batched edits per directory).
4. Update edge functions; redeploy.
5. Update `index.html`, `public/offline.html`, `public/sw-offline-navigation.js`, manifest icons.
6. Update memory index.
7. Run `bunx vitest run` on affected suites (offline-storage, sync, helper-store, photo-uploaded contract). Visual QA: load `/`, `/dashboard`, `/install`, `/profile`, and one inspection report HTML.

### Verification checklist

- `rg -i 'rope.?works'` returns only: Sentry IDs in comments/tests, historical migration SQL, and the external bucket string.
- New `belay-reports-inspections` DB exists in DevTools after first load; reports/photos/drafts still visible.
- One sample inspection PDF and one training PDF render with new stacked logo (no broken image).
- Sign-in, dashboard, and report viewer all show the new wide logo.
- Test inbox: trigger a report email and a backup email; both arrive with new `Belay Reports` branding from `@mail.belayreports.com`.

### Rollback

- Logos: revert asset pointer JSONs.
- IDB: clear `localStorage['db-renamed-v1']` and revert constants — old DB is preserved for 30 days.
- Edge functions: redeploy previous version from git history.
