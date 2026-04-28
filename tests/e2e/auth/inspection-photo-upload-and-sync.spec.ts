import { expect, test } from '@playwright/test';
import { signIn } from '../_fixtures/auth';
import {
  MARKER_PREFIX,
  captureSupabaseSession,
  getInspectionPhotoStoragePaths,
  purgeInspectionPhotoStorageObjects,
  purgeMarkedInspectionPhotoStorageObjects,
  purgeMarkedInspections,
  waitForInspectionInCloud,
  waitForInspectionPhotoInCloud,
  type SupabaseTestSession,
} from '../_fixtures/supabase';

/**
 * Tier-2 #5d — inspection photo upload + sync golden path.
 *
 * Verifies that a photo attached to an inspection survives the full
 * round-trip: local capture → background upload → cloud row → page reload
 * → row still present.
 *
 * Flow:
 *   1. Sign in as the test user.
 *   2. Pre-flight: walk every `[E2E DEVIN]`-marked inspection still owned by
 *      this user, collect the storage paths of any `inspection_photos`
 *      rows attached to them, delete those storage objects, then delete
 *      the inspections themselves (FK CASCADE removes the photo rows).
 *      Without the storage step, leaked objects would accumulate forever
 *      since no FK ties them to the parent inspection.
 *   3. Create an inspection ONLINE with a `[E2E DEVIN] <ts>` marker.
 *   4. Wait for the inspection to land in Supabase, capture its server id.
 *   5. Open `/inspection/<id>`. The default tab ("details") mounts a
 *      `<PhotoCapture section="systems" />` (`InspectionForm.tsx:3206`)
 *      with a hidden `<input type="file" accept="image/jpeg,…">` that
 *      Playwright can drive directly via `setInputFiles`. We bypass the
 *      "Upload" button click and target the input by its non-`capture`
 *      attribute — `capture="environment"` is the camera input which
 *      ignores `setInputFiles` (it expects a live MediaStream).
 *   6. Hand the input a tiny in-memory JPEG buffer. `processFiles` saves
 *      it to IDB → fires `uploadPhotoInBackground` → uploads to the
 *      `inspection-photos` bucket → INSERTs into `inspection_photos`.
 *   7. Poll `inspection_photos` for a row with this inspection_id and
 *      `photo_section='systems'` — the upload-completion oracle.
 *   8. Reload `/inspection/<id>` in the same browser context. After
 *      reload, verify the row STILL exists in cloud (proves the upload
 *      was durable, not just a transient toast). One re-poll covers any
 *      eventual-consistency lag the original wait already absorbed.
 *   9. Verify the gallery rendered for the photo: at least one
 *      `<img>` element appears inside the systems-section gallery
 *      (`PhotoGallery section="systems"` at `InspectionForm.tsx:3213`).
 *      Any `<img>` is sufficient — the spec doesn't try to load-check the
 *      blob, only that the React tree wired the row through.
 *  10. Post-flight: collect this inspection's storage paths, delete them,
 *      then delete the inspection (cascades the photo row away).
 *
 * Requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD; the entire describe is
 * skipped without them so CI on machines lacking the secrets doesn't
 * spuriously fail (same gating as the existing scope-C/cloud-backup
 * specs).
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

/**
 * Smallest possible valid baseline JPEG (1×1 pixel, all-white). 125 bytes.
 * Generated once and inlined as base64 to avoid a fixture-file dependency
 * on the e2e runner. Decoded by `compressImage` via `createImageBitmap`,
 * which is a noop at this size (already under all thresholds).
 *
 * We pick JPEG over PNG because the upload's `accept` list permits both
 * but `compressImage` re-encodes everything to JPEG anyway, so this saves
 * one re-encode step on the test path.
 */
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE' +
  'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ' +
  'EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/' +
  '8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAA' +
  'AAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z';

test.describe('inspection photo: upload + sync golden path', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Skipping inspection-photo e2e: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run.'
  );

  // Build (cached across specs) + login + create + cloud round-trip + form
  // load + photo capture pipeline + cloud round-trip + reload + cleanup.
  // CI runners on GitHub Actions consistently see ~3-5x the Supabase
  // round-trip latency seen locally, so 4 min mirrors what scope-C and
  // cloud-backup converged on after PR #25 + Lovable's recent bumps to
  // the admin-pre-edit-override budget on main.
  test.setTimeout(240_000);

  test('online create → attach photo → cloud row exists → survives reload', async ({
    page,
  }) => {
    const uncaught: Error[] = [];
    page.on('pageerror', (err) => {
      // Lazy-chunk fetch failures while online aren't expected, but the
      // existing scope-C / cloud-backup specs filter this class because
      // it's a known separate PWA concern; mirror the filter so a
      // transient SW miss doesn't trip the assertion at the end.
      if (/Failed to fetch dynamically imported module/i.test(err.message)) {
        return;
      }
      uncaught.push(err);
    });

    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) {
        console.log(`[browser ${msg.type()}] ${msg.text()}`);
      }
    });

    // ── 1. Sign in ────────────────────────────────────────────────────────
    await signIn(page);
    const session: SupabaseTestSession = await captureSupabaseSession(page);

    try {
      // ── 2. Pre-flight cleanup ────────────────────────────────────────────
      // Storage objects FIRST — they aren't FK-cascaded so they have to be
      // removed before the parent inspection (which IS cascaded) goes away.
      const purgedStorage =
        await purgeMarkedInspectionPhotoStorageObjects(session);
      const purgedInspections = await purgeMarkedInspections(session);
      if (purgedStorage > 0 || purgedInspections > 0) {
        console.log(
          `[e2e cleanup] removed ${purgedStorage} stale storage objects and ${purgedInspections} stale inspections`
        );
      }

      // ── 3. Create inspection ONLINE ──────────────────────────────────────
      await page.goto('/inspection/new');
      await expect(
        page.getByText(/new inspection report/i).first()
      ).toBeVisible({ timeout: 15_000 });

      const marker = `${MARKER_PREFIX} ${Date.now()}`;
      const orgCombo = page.getByRole('combobox', {
        name: /select or type organization/i,
      });
      await orgCombo.click();
      await orgCombo.fill(marker);
      await page.keyboard.press('Tab');

      await page.getByPlaceholder(/enter location/i).fill(marker);
      await page.getByRole('button', { name: /^create inspection$/i }).click();

      // ── 4. Wait for the inspection to reach Supabase ─────────────────────
      const createdRow = await waitForInspectionInCloud(session, marker, {
        timeoutMs: 180_000,
      });
      const serverId = createdRow.id as string;
      expect(serverId, 'created row should have a server id').toBeTruthy();

      // ── 5. Open the inspection form (default tab = "details", which
      //    contains the systems-section PhotoCapture). ─────────────────────
      await page.goto(`/inspection/${serverId}`);
      await expect(page.getByPlaceholder(/enter location/i)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByPlaceholder(/enter location/i)).toHaveValue(
        marker,
        { timeout: 30_000 }
      );

      // ── 6. Attach a photo via the hidden upload input ────────────────────
      // PhotoCapture renders two file inputs: a camera input with
      // `capture="environment"` (Playwright cannot drive these — they
      // expect a MediaStream, not a file blob) and an upload input with
      // `accept="image/jpeg,image/png,…"`. We target the upload input by
      // its `accept` attribute prefix to avoid matching the camera one.
      // The input is hidden via `className="hidden"`, but `setInputFiles`
      // works on hidden inputs — only DOM presence matters.
      const uploadInput = page
        .locator('input[type="file"][accept^="image/jpeg"]')
        .first();
      await expect(uploadInput).toBeAttached({ timeout: 30_000 });

      const photoBuffer = Buffer.from(TINY_JPEG_BASE64, 'base64');
      await uploadInput.setInputFiles({
        name: 'e2e-test-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: photoBuffer,
      });

      // ── 7. Poll for the inspection_photos row ────────────────────────────
      // Section is hard-coded to 'systems' here because the default-tab
      // PhotoCapture mounts as `section="systems"`
      // (`InspectionForm.tsx:3208`). Filtering by section as well as
      // inspection_id makes the oracle robust against a leaked row from
      // a prior interrupted run that we missed in pre-flight.
      const photoRow = await waitForInspectionPhotoInCloud(session, {
        inspectionId: serverId,
        section: 'systems',
        timeoutMs: 120_000,
      });
      expect(photoRow.inspection_id).toBe(serverId);
      expect(photoRow.photo_section).toBe('systems');
      expect(
        photoRow.photo_url,
        'photo_url should be a non-empty storage path'
      ).toBeTruthy();

      // ── 8. Reload page; row must STILL exist (durability check) ──────────
      // The reload exercises the same code path a user hits when they
      // navigate away and come back, or restart the app entirely. If the
      // upload was somehow only ephemeral (e.g. only in IDB, never
      // synced), the second poll fails immediately and the spec catches
      // the regression.
      await page.goto(`/inspection/${serverId}`);
      await expect(page.getByPlaceholder(/enter location/i)).toBeVisible({
        timeout: 30_000,
      });

      const photoRowAfterReload = await waitForInspectionPhotoInCloud(
        session,
        {
          inspectionId: serverId,
          section: 'systems',
          // Tight budget — the row was just confirmed to exist; this is a
          // "still there?" check, not a "has it landed yet?" check. If
          // this times out, something deleted it during the reload.
          timeoutMs: 15_000,
        }
      );
      expect(photoRowAfterReload.id).toBe(photoRow.id);

      // ── 9. Gallery should render the photo after reload ──────────────────
      // PhotoGallery (`InspectionForm.tsx:3213`) renders one `<img>` per
      // row in `inspection_photos`. The signed-URL `src` always embeds
      // the storage path, which is shaped `{userId}/{inspectionId}/…`
      // (`PhotoCapture.tsx:174`). Matching `img[src*=<serverId>]`
      // therefore selects ONLY photos belonging to this inspection —
      // unrelated app images (logo, avatars, icons) are excluded, which
      // is the failure mode a generic `img.first()` would silently pass
      // through.
      const galleryImg = page.locator(`img[src*="${serverId}"]`).first();
      await expect(galleryImg).toBeVisible({ timeout: 30_000 });

      // ── 10. Post-flight cleanup ──────────────────────────────────────────
      // Collect this inspection's storage paths BEFORE the inspection
      // delete (which cascades the photo row); delete storage objects;
      // delete the inspection.
      const myPaths = await getInspectionPhotoStoragePaths(session, serverId);
      const purgedAfterStorage = await purgeInspectionPhotoStorageObjects(
        session,
        myPaths
      );
      const purgedAfterInspections = await purgeMarkedInspections(session);
      console.log(
        `[e2e cleanup] post-flight: removed ${purgedAfterStorage} storage objects (of ${myPaths.length} candidates) and ${purgedAfterInspections} inspections`
      );

      // No uncaught page errors should have leaked (filtered above).
      expect(
        uncaught,
        `Page should not surface uncaught errors: ${uncaught
          .map((e) => e.message)
          .join('; ')}`
      ).toEqual([]);
    } finally {
      // Always release the APIRequestContext. Without this, file
      // descriptors leak across the worker process for the remainder of
      // the run — same lesson as PR #42's try/finally.
      await session.apiClient.dispose();
    }
  });
});
