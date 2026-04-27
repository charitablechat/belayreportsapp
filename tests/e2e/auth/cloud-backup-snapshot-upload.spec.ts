import { expect, test } from '@playwright/test';
import { signIn } from '../_fixtures/auth';
import {
  MARKER_PREFIX,
  captureSupabaseSession,
  purgeMarkedCloudBackups,
  purgeMarkedInspections,
  waitForCloudBackup,
  waitForInspectionInCloud,
  waitForInspectionLocationInCloud,
  type SupabaseTestSession,
} from '../_fixtures/supabase';

/**
 * Tier-2 #5a — cloud-backup auto-upload golden path.
 *
 * Flow:
 *   1. Sign in.
 *   2. Pre-flight: delete any prior `[E2E DEVIN]` cloud-backup rows AND
 *      inspections for this user (older specs may have left them behind).
 *   3. Create an inspection ONLINE with a `[E2E DEVIN] <ts>` org marker.
 *   4. Wait for the inspection itself to reach Supabase.
 *   5. Open `/inspection/<id>` and trigger an edit + explicit Save Progress.
 *      The "Create Inspection" button at `/inspection/new` bypasses
 *      `local-backup-ledger::saveReportSnapshot` — only `performSave`
 *      (the form save path) fires it. So a real edit-then-save is what
 *      produces the FIRST cloud-backup row.
 *   6. Wait for the post-edit value to land in Supabase (proves
 *      `performSave` actually completed).
 *   7. Wait for `report_cloud_backups` to contain a row for this
 *      (`report_type`, `report_id`) — the auto-upload oracle.
 *      `saveReportSnapshot` fire-and-forget calls
 *      `cloud-backup::uploadSnapshotToCloud`.
 *   8. Post-flight: delete the cloud-backup rows + the inspection.
 *
 * What this spec deliberately does NOT cover (deferred follow-ups):
 *   - The `snapshot_ts` ratchet on a SECOND edit. Earlier iterations of
 *     this spec attempted to do two edits + reload + verify the upsert
 *     advanced the timestamp; CI surfaced a series of unrelated
 *     environmental flakes (browser-side `TypeError: Failed to fetch`
 *     spam, debounced-autosave-vs-hydration races) that the ratchet
 *     check was disproportionately sensitive to. We're shipping the
 *     single-edit golden path now and tracking the ratchet as a future
 *     follow-up once the fixture infrastructure has more REST oracles
 *     and runner stability is better understood. (See
 *     https://github.com/charitablechat/ropeworks-5b9736d7/pull/29
 *     conversation for full context.)
 *   - The **restore** half of the round-trip. `restoreSnapshotToServer`
 *     is super-admin gated; the user-side restore path writes to IDB
 *     only and is fiddly to assert through a Playwright UI without
 *     making the spec brittle. Tier-1 #3 (manual QA on real devices)
 *     remains the canonical "we trust restore" verification.
 *
 * Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD; the entire describe is
 * skipped without them so CI on machines lacking the secrets doesn't
 * spuriously fail (same gating as the existing scope-C spec).
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

test.describe('cloud-backup: snapshot auto-upload on edit', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Skipping cloud-backup e2e: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run.'
  );

  // Build (cached across specs) + login + online create + cloud
  // round-trip + form load + edit + cloud round-trip + cleanup. CI
  // runners on GitHub Actions consistently see ~3-5x the Supabase
  // round-trip latency seen locally, so 3 min is generous but safer
  // than a flaky 90s. Mirrors the budget that scope-C ended up at
  // after PR #25.
  test.setTimeout(180_000);

  test('online create → edit → save → cloud-backup row exists', async ({
    page,
  }) => {
    const uncaught: Error[] = [];
    page.on('pageerror', (err) => {
      // Lazy-chunk fetch failures while online aren't expected, but the
      // existing scope-C spec filters this class because it's a known
      // separate PWA concern; mirror the filter so a transient SW miss
      // doesn't trip the assertion at the end.
      if (/Failed to fetch dynamically imported module/i.test(err.message)) {
        return;
      }
      uncaught.push(err);
    });

    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) {
        // eslint-disable-next-line no-console
        console.log(`[browser ${msg.type()}] ${msg.text()}`);
      }
    });

    // ── 1. Sign in ────────────────────────────────────────────────────────
    await signIn(page);

    // ── 2. Pre-flight cleanup ────────────────────────────────────────────
    const session: SupabaseTestSession = await captureSupabaseSession(page);
    const purgedBackups = await purgeMarkedCloudBackups(session);
    const purgedInspections = await purgeMarkedInspections(session);
    if (purgedBackups > 0 || purgedInspections > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[e2e cleanup] removed ${purgedBackups} stale cloud backups and ${purgedInspections} stale inspections`
      );
    }

    // ── 3. Create inspection ONLINE ──────────────────────────────────────
    await page.goto('/inspection/new');
    await expect(
      page.getByText(/new inspection report/i).first()
    ).toBeVisible({ timeout: 15_000 });

    const marker = `${MARKER_PREFIX} ${Date.now()}`;
    const markerEdited = `${marker} edited`;

    // The org combobox value flows into `snapshot.parent.organization`,
    // which `cloud-backup::_doUpload` writes to the row's `facility`
    // column. We use the SAME marker for org + location so the
    // facility-prefix purge can reliably find these rows even if the
    // inspection itself was already deleted.
    const orgCombo = page.getByRole('combobox', {
      name: /select or type organization/i,
    });
    await orgCombo.click();
    await orgCombo.fill(marker);
    await page.keyboard.press('Tab');

    await page.getByPlaceholder(/enter location/i).fill(marker);

    await page.getByRole('button', { name: /^create inspection$/i }).click();

    // ── 4. Wait for the inspection itself to reach Supabase ──────────────
    const createdRow = await waitForInspectionInCloud(session, marker, {
      timeoutMs: 120_000,
    });
    const serverId = createdRow.id as string;
    expect(serverId, 'created row should have a server id').toBeTruthy();

    // ── 5. Open the inspection form ──────────────────────────────────────
    await page.goto(`/inspection/${serverId}`);
    const locationInput = page.getByPlaceholder(/enter location/i);
    await expect(locationInput).toBeVisible({ timeout: 30_000 });
    await expect(locationInput).toHaveValue(marker, { timeout: 30_000 });

    // Save Progress button = explicit `saveProgress()` invocation, which
    // routes through `performSave` → `saveReportSnapshot` →
    // `uploadSnapshotToCloud`. We use it instead of relying on
    // blur-triggered autosave because (a) autosave is debounced and was
    // observed in CI to silently no-op when the form is mid-hydration,
    // and (b) explicit save is a more deterministic oracle for the
    // first cloud-backup row.
    const saveButton = page.getByRole('button', {
      name: /^(save progress|save locally|save)\.{0,3}$/i,
    });

    // ── 6. Edit + save → verify Supabase ─────────────────────────────────
    // Drive the location input via React's `__valueTracker` setter (same
    // escape hatch as scope-C; survives focus/keyboard timing on CI),
    // then click Save Progress and wait for the saving state to clear.
    await locationInput.click();
    await locationInput.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, markerEdited);
    await expect(locationInput).toHaveValue(markerEdited, { timeout: 5_000 });

    // Wait until the Save button is enabled (saving/autoSaving idle)
    // before clicking; clicking a disabled button is a silent no-op in
    // Playwright with no warning.
    await expect(saveButton.first()).toBeEnabled({ timeout: 15_000 });
    await saveButton.first().click();

    // Wait for the saving spinner to clear — proves performSave's
    // promise resolved (and saveReportSnapshot fired).
    await expect(saveButton.first()).toBeEnabled({ timeout: 30_000 });

    await waitForInspectionLocationInCloud(session, {
      id: serverId,
      expectedLocation: markerEdited,
      timeoutMs: 120_000,
    });

    // ── 7. Wait for the cloud-backup auto-upload ─────────────────────────
    const backup = await waitForCloudBackup(session, {
      reportType: 'inspection',
      reportId: serverId,
      timeoutMs: 120_000,
    });
    expect(backup.snapshot_ts, 'backup should have a ts').toBeGreaterThan(0);
    expect(backup.user_id).toBe(session.userId);
    expect(backup.facility).toBe(marker);

    // ── 8. Post-flight cleanup ──────────────────────────────────────────
    const purgedAfterBackups = await purgeMarkedCloudBackups(session);
    const purgedAfterInspections = await purgeMarkedInspections(session);
    // eslint-disable-next-line no-console
    console.log(
      `[e2e cleanup] post-flight: removed ${purgedAfterBackups} cloud backups and ${purgedAfterInspections} inspections`
    );

    // No uncaught page errors should have leaked (filtered above).
    expect(uncaught, `uncaught page errors: ${uncaught.map((e) => e.message).join('; ')}`).toEqual([]);

    // Dispose the APIRequestContext that captureSupabaseSession() opened
    // via `request.newContext()`. Playwright doesn't auto-clean these —
    // they hold connections + stored responses until explicitly disposed.
    // Mirrors the cleanup pattern in `offline-edit-reconcile.spec.ts`.
    await session.apiClient.dispose();
  });
});
