import { expect, test } from '@playwright/test';
import { signIn } from '../_fixtures/auth';
import { requireE2EAuthAllowed } from '../_fixtures/safety';
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
  requireE2EAuthAllowed();
  test.skip(
    !EMAIL || !PASSWORD,
    'Skipping scope-C e2e: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run.'
  );

  // Full round-trip: build (cached across specs) + login + online create +
  // cloud round-trip + form load + offline edit + sync-now + second cloud
  // round-trip + cleanup.
  //
  // Mode 10A: 180s → 240s so the inner step-10 reconcile-wait (150s, line
  // 268) is always the first timeout to fire on slow CI runners, producing
  // a clear "waitForInspectionLocationInCloud" diagnostic instead of a
  // confusing Playwright outer-timeout error. Steps 1-9 carry their own
  // sub-budgets (step 4 cloud poll = 120s, step 5 form-hydrate = 30s × 2,
  // step 5a IDB-drain poll = 30s, step 7 fill assertion = 5s, step 9
  // sync-now visibility = 5s). The earlier steps run concurrently with
  // the network being healthy (the wedge only manifests post-`setOffline`
  // at step 8), so they typically consume <30s on green-path runs and
  // <60s on degraded runs. 240s = 150s (step 10) + 90s for everything
  // else preserves a meaningful inner-first failure ordering even on the
  // slowest GitHub Actions runners.
  test.setTimeout(240_000);

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

    // ── 5a. Wait for the local autosync to fully drain ────────────────────
    // `waitForInspectionInCloud` returns the moment the row appears on
    // Supabase, but the autosync's atomic transaction is still in flight
    // doing post-create work (writing back `synced_at`, releasing the
    // record from the dirty queue, etc.). If we go offline before that
    // finishes, Chromium cancels the in-flight fetch with `Failed to
    // fetch`, which used to push the record toward the H5 quarantine
    // threshold. The H5-T network-error classifier in
    // `src/lib/sync-quarantine.ts` no longer counts those toward the
    // 3-strike budget, but pin the spec contract anyway so a future
    // regression is caught here too — and the spec stays meaningful even
    // if the classifier is loosened/tightened.
    //
    // We poll the IDB record directly until `synced_at !== null`. 30s is
    // generous for the post-create writeback (typically <2s); if it
    // doesn't drain in 30s something else is wrong.
    await page.waitForFunction(
      async (recordId) => {
        try {
          const dbReq = indexedDB.open('rope-works-inspections');
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => reject(dbReq.error);
          });
          if (!db.objectStoreNames.contains('inspections')) {
            db.close();
            return false;
          }
          const tx = db.transaction('inspections', 'readonly');
          const row = await new Promise<unknown>((resolve, reject) => {
            const r = tx.objectStore('inspections').get(recordId);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          db.close();
          if (!row || typeof row !== 'object') return false;
          const synced = (row as { synced_at?: unknown }).synced_at;
          return typeof synced === 'string' && synced.length > 0;
        } catch {
          return false;
        }
      },
      serverId,
      { timeout: 30_000, polling: 250 },
    );

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
    // Mode 10A: 120s → 150s. The Mode 8/9 stack reduced the post-online
    // IDB wedge tail from 4-6 min (PR #108) to ~2 min (PR #110). On the
    // GitHub Actions runner that produced the failing run on PR #110,
    // the layer recovered at 134s — about 14s past the previous 120s
    // budget. Per W3C IDB (no `IDBOpenDBRequest` abort), the wedge tail
    // can't be reduced further without an alternate read path (deferred
    // as Mode 11 / 9C). Bumping to 150s captures the post-Mode-9
    // distribution; the outer `test.setTimeout(240_000)` above keeps
    // a 90s buffer for steps 1-9 + cleanup, so this inner timeout is
    // always the first to fire on a wedge. See
    // `mode-10-residual-wedge-diagnostic.md` for the full timeline +
    // recovery-margin analysis.
    const edited = await waitForInspectionLocationInCloud(session, {
      id: serverId,
      expectedLocation: editedMarker,
      timeoutMs: 150_000,
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
