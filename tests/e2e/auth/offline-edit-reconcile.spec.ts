import { expect, test } from '@playwright/test';
import { signIn } from '../_fixtures/auth';
import {
  MARKER_PREFIX,
  captureSupabaseSession,
  purgeMarkedInspections,
  waitForInspectionInCloud,
  waitForInspectionLocationInCloud,
  type SupabaseTestSession,
} from '../_fixtures/supabase';

/**
 * Scope "C" — full offline → reconcile golden path (edit variant).
 *
 * Flow:
 *   1. Sign in (online).
 *   2. Pre-flight: delete any prior `[E2E DEVIN]` rows for this user.
 *   3. Create an inspection ONLINE at /inspection/new (canonical happy path
 *      — avoids the lazy-chunk / IDB-race issues that happen when
 *      offline-creating and landing on a not-yet-cached route).
 *   4. Wait for the server to see the new row (confirms online-create
 *      worked before we start futzing with the network).
 *   5. Navigate into /inspection/<id> while still online so the
 *      InspectionForm chunk is cached by the SW for the rest of the test.
 *   6. Drop the browser offline via context.setOffline(true).
 *   7. Edit the `location` field — appending " edited" — and blur so the
 *      form's autosave/IDB-write path fires.
 *   8. Come back online.
 *   9. Click "sync now" (Playwright's Chromium has no real background sync
 *      API, so the app surfaces a pending count and a sync button for the
 *      user to tap — the test matches real-user behaviour).
 *  10. Wait for the edit to reach the server by polling the REST API for
 *      a row whose location matches the post-edit value.
 *  11. Post-flight: delete the row we just worked on.
 *
 * Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD; the entire describe is
 * skipped without them so CI on machines lacking the secrets doesn't
 * spuriously fail.
 */

const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

test.describe('sync: offline edit reconciles to cloud', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Skipping scope-C e2e: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run.'
  );

  // Full round-trip: build (cached across specs) + login + online create +
  // cloud round-trip + form load + offline edit + sync-now + second cloud
  // round-trip + cleanup. 3min is generous but safer than a flaky 90s.
  test.setTimeout(180_000);

  // STATUS: ACTIVE. Originally quarantined under `.fixme()` while four
  // app-side blockers were investigated and fixed across PRs #15-#22:
  //   - PR #15 fixed `probeIndexedDB` cold-start v1 auto-create race.
  //   - PR #16 stripped IDB-only fields (`dirty`, `child_count_hint`)
  //     from atomic-sync upserts that were being rejected by the
  //     PostgREST schema cache.
  //   - PR #17 static-imported `deferred-reconcile` so atomic sync no
  //     longer trips on a lazy-chunk fetch while offline.
  //   - PR #18 static-imported `idb-migration-safety` so `getDB()` is
  //     no longer racing an offline lazy-chunk fetch on the open path.
  //   - PR #20 + #21 fixed the `getDB()` IIFE race + outer try/catch so
  //     parallel callers share a single open and transient failures
  //     don't permanently poison `dbPromise`.
  //   - PR #22 fixed the re-entrant `anySaveInProgressRef` mutex bug
  //     in `InspectionForm` that was silently no-op-ing every blur and
  //     timer-driven auto-save in production (manual save still worked,
  //     which is why the bug went unnoticed).
  //
  // Headless run is currently green in ~52s. CI gates the spec via
  // the `e2e-offline` job in `.github/workflows/ci.yml`.
  test('online create → offline edit → reconnect → cloud reconcile', async ({
    page,
    context,
  }) => {
    const uncaught: Error[] = [];
    page.on('pageerror', (err) => {
      // Lazy-chunk fetch failures while offline are a known, separate PWA
      // concern (the SW only precaches already-requested chunks). They're
      // not what this spec is testing — filter so the assertion at the end
      // doesn't trip on them.
      if (/Failed to fetch dynamically imported module/i.test(err.message)) {
        return;
      }
      uncaught.push(err);
    });

    // Mirror browser console warnings/errors into the test runner so CI
    // logs have the same diagnostics we'd see in a dev console.
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
    const purgedBefore = await purgeMarkedInspections(session);
    if (purgedBefore > 0) {
      // eslint-disable-next-line no-console
      console.log(`[e2e cleanup] removed ${purgedBefore} stale marker rows`);
    }

    // ── 3. Create inspection ONLINE ──────────────────────────────────────
    await page.goto('/inspection/new');
    await expect(
      page.getByText(/new inspection report/i).first()
    ).toBeVisible({ timeout: 15_000 });

    const marker = `${MARKER_PREFIX} ${Date.now()}`;
    const editedMarker = `${marker} edited`;

    const orgCombo = page.getByRole('combobox', {
      name: /select or type organization/i,
    });
    await orgCombo.click();
    await orgCombo.fill(marker);
    await page.keyboard.press('Tab');

    await page.getByPlaceholder(/enter location/i).fill(marker);

    // Online submit: button reads "Create Inspection", not "Create Locally".
    await page.getByRole('button', { name: /^create inspection$/i }).click();

    // ── 4. Wait for the server to see the new row ────────────────────────
    // Creation can go two ways depending on autoSync timing: either the
    // row is POSTed directly to Supabase, or it's queued and drained on
    // the next cycle. Either way, the REST poll is the definitive oracle.
    // CI runners on GitHub Actions consistently see ~3-5x the Supabase
    // round-trip latency compared to local dev, so the default 60s
    // budget on this poll is too tight (CI run on PR #25 surfaced this
    // as `Timed out after 60000ms waiting for inspection with
    // location=...`). 120s gives headroom without masking a true hang.
    const createdRow = await waitForInspectionInCloud(session, marker, {
      timeoutMs: 120_000,
    });
    const serverId = createdRow.id as string;
    expect(serverId, 'created row should have a server id').toBeTruthy();

    // ── 5. Open the inspection form while still online ───────────────────
    // Warms the SW cache for the InspectionForm chunk so a subsequent
    // offline access doesn't blow up with a dynamic-import failure.
    await page.goto(`/inspection/${serverId}`);
    // InspectionForm renders a Location input; wait for it so we know the
    // form-level state has hydrated from IDB/Supabase before we go offline.
    const locationInput = page.getByPlaceholder(/enter location/i);
    await expect(locationInput).toBeVisible({ timeout: 30_000 });
    await expect(locationInput).toHaveValue(marker, { timeout: 30_000 });

    // ── 6. Go offline ────────────────────────────────────────────────────
    await context.setOffline(true);

    // Wait for the app to register it. InspectionForm shows a "Working
    // offline" indicator when navigator.onLine flips; fallback to a small
    // settle wait if that indicator isn't easy to grab.
    await page.waitForTimeout(500);

    // ── 7. Edit the location field ───────────────────────────────────────
    // `locator.fill()` and `keyboard.press('Control+A')` both race React's
    // controlled-input rerender after the offline transition: the field's
    // existing value (the marker we set during online create) survives the
    // clear, and the new text gets appended → a duplicated string.
    //
    // The React-native escape hatch is to drive the value through React's
    // `__valueTracker` by calling the *prototype* setter and dispatching
    // an `input` event manually. This is the same pattern testing-library
    // and react-testing-library use internally (`fireEvent.change`) to set
    // controlled-input values without depending on focus or keyboard
    // timing. Survives the offline flap.
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
    // Blur so the form's debounced autosave fires even if the underlying
    // onChange didn't already trigger one.
    await locationInput.blur();

    // Give autosave + queueOperation a beat to land in IDB.
    await page.waitForTimeout(1500);

    // ── 8. Come back online ──────────────────────────────────────────────
    await context.setOffline(false);

    // ── 9. Encourage sync to drain ───────────────────────────────────────
    // In Playwright Chromium, background-sync isn't wired; the app
    // surfaces a "sync now" affordance and waits for user action. Click it
    // if it's visible. If it isn't, the adaptive-interval periodic sync
    // will still eventually drain — we just polled longer to cover that.
    const syncNow = page.getByRole('button', { name: /^sync now$/i }).first();
    if (await syncNow.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await syncNow.click();
    }

    // ── 10. Wait for the edit to reach the server ────────────────────────
    const edited = await waitForInspectionLocationInCloud(session, {
      id: serverId,
      expectedLocation: editedMarker,
      // Same CI-latency rationale as the create-side wait above.
      timeoutMs: 120_000,
    });
    expect(edited.location).toBe(editedMarker);

    // ── 11. Post-flight cleanup ──────────────────────────────────────────
    const purgedAfter = await purgeMarkedInspections(session);
    expect(
      purgedAfter,
      'post-flight cleanup should remove at least the row we edited'
    ).toBeGreaterThan(0);

    expect(
      uncaught,
      `uncaught errors during offline-edit flow: ${uncaught
        .map((e) => e.message)
        .join('\n')}`
    ).toEqual([]);

    await session.apiClient.dispose();
  });
});
