import { expect, test } from '@playwright/test';
import { signIn } from '../_fixtures/auth';
import {
  MARKER_PREFIX,
  captureSupabaseSession,
  purgeMarkedCloudBackups,
  purgeMarkedInspections,
  waitForCloudBackup,
  waitForCloudBackupTsAdvance,
  waitForInspectionInCloud,
  waitForInspectionLocationInCloud,
  type SupabaseTestSession,
} from '../_fixtures/supabase';

/**
 * Tier-2 #5a — cloud-backup auto-upload + ratchet golden path.
 *
 * Flow:
 *   1. Sign in.
 *   2. Pre-flight: delete any prior `[E2E DEVIN]` cloud-backup rows AND
 *      inspections for this user (older specs left them behind).
 *   3. Create an inspection ONLINE with a `[E2E DEVIN] <ts>` org marker.
 *   4. Wait for the inspection itself to reach Supabase (existing oracle).
 *   5. Wait for `report_cloud_backups` to contain a row for this
 *      (`report_type`, `report_id`) — the auto-upload oracle. Each save
 *      in the form path fires `local-backup-ledger::saveReportSnapshot`,
 *      which fire-and-forget calls
 *      `cloud-backup::uploadSnapshotToCloud`.
 *   6. Edit the inspection's `location`, blur to fire autosave.
 *   7. Wait for the post-edit value to land in Supabase (proves the form
 *      actually saved).
 *   8. Wait for the cloud-backup row's `snapshot_ts` to advance past the
 *      first one — proves the second upload after edit landed (the
 *      upsert hits `(user_id, report_type, report_id)`, so the row's
 *      identity is stable; only the timestamp changes).
 *   9. Post-flight: delete the cloud-backup rows + the inspection.
 *
 * What this spec deliberately does NOT cover:
 *   - The **restore** half of the round-trip. `restoreSnapshotToServer`
 *     is super-admin gated; the user-side restore path writes to IDB
 *     only and is fiddly to assert through a Playwright UI without
 *     making the spec brittle. Tier-1 #3 (manual QA on real devices)
 *     remains the canonical "we trust restore" verification.
 *   - The Data Recovery sheet UI. Adding sheet-open + list-row
 *     assertions is straightforward but couples the spec to the
 *     dropdown trigger and SheetTitle copy — REST oracles are far more
 *     stable than DOM assertions for what is fundamentally a
 *     server-side ratchet.
 *
 * Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD; the entire describe is
 * skipped without them so CI on machines lacking the secrets doesn't
 * spuriously fail (same gating as the existing scope-C spec).
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

test.describe('cloud-backup: snapshot auto-upload and ratchet on edit', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Skipping cloud-backup e2e: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run.'
  );

  // Build (cached across specs) + login + online create + cloud round-trip
  // + form load + edit + cloud round-trip + ratchet poll + cleanup. CI
  // runners on GitHub Actions consistently see ~3-5x the Supabase
  // round-trip latency seen locally, so 3 min is generous but safer than
  // a flaky 90s. Mirrors the budget that scope-C ended up at after PR #25.
  test.setTimeout(180_000);

  test('online create → cloud-backup upload → online edit → cloud-backup ratchet', async ({
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
    const editedMarker = `${marker} edited`;

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

    // ── 5. Wait for the FIRST cloud-backup auto-upload ───────────────────
    // `local-backup-ledger::saveReportSnapshot` fires
    // `cloud-backup::uploadSnapshotToCloud` after every save. The upload
    // is fire-and-forget, so it can race the inspection insert; polling
    // is the cleanest oracle.
    const firstBackup = await waitForCloudBackup(session, {
      reportType: 'inspection',
      reportId: serverId,
      timeoutMs: 120_000,
    });
    expect(firstBackup.snapshot_ts, 'first backup should have a ts').toBeGreaterThan(0);
    expect(firstBackup.user_id).toBe(session.userId);
    expect(firstBackup.facility).toBe(marker);

    // ── 6. Open the inspection form and edit the location ────────────────
    await page.goto(`/inspection/${serverId}`);
    const locationInput = page.getByPlaceholder(/enter location/i);
    await expect(locationInput).toBeVisible({ timeout: 30_000 });
    await expect(locationInput).toHaveValue(marker, { timeout: 30_000 });

    // Drive the value through React's `__valueTracker` (same escape
    // hatch the scope-C spec uses) so the controlled-input update lands
    // even if focus/keyboard timing is off.
    await locationInput.click();
    await locationInput.evaluate((el, value) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, editedMarker);
    await expect(locationInput).toHaveValue(editedMarker, { timeout: 5_000 });
    // Blur fires the form's debounced autosave path.
    await locationInput.blur();

    // ── 7. Wait for the edit to reach Supabase ───────────────────────────
    await waitForInspectionLocationInCloud(session, {
      id: serverId,
      expectedLocation: editedMarker,
      timeoutMs: 120_000,
    });

    // ── 8. Wait for the cloud-backup snapshot_ts to advance ──────────────
    // The row identity is stable across the upsert
    // (`onConflict: 'user_id,report_type,report_id'`) so we're polling
    // for the timestamp to ratchet, not for a new row.
    const secondBackup = await waitForCloudBackupTsAdvance(session, {
      reportType: 'inspection',
      reportId: serverId,
      afterTs: firstBackup.snapshot_ts,
      timeoutMs: 120_000,
    });
    expect(secondBackup.snapshot_ts).toBeGreaterThan(firstBackup.snapshot_ts);
    // The upsert should land on the same row id — confirms it's a true
    // ratchet, not a duplicate row created by a constraint mismatch.
    expect(secondBackup.id).toBe(firstBackup.id);

    // ── 9. Post-flight cleanup ───────────────────────────────────────────
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
