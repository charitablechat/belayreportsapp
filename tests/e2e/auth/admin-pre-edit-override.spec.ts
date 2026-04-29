import { expect, test } from '@playwright/test';
import { signIn, signOut } from '../_fixtures/auth';
import {
  MARKER_PREFIX,
  captureSupabaseSession,
  probeAdminEditSnapshotInsertPolicy,
  purgeMarkedInspections,
  waitForAdminEditSnapshot,
  waitForInspectionInCloud,
  waitForInspectionLocationInCloud,
  type SupabaseTestSession,
} from '../_fixtures/supabase';

/**
 * Tier-2 #5c — admin pre-edit override golden path.
 *
 * Gates the audit-trail capture that fires when an admin saves a report
 * owned by another user. `InspectionForm.performSave` calls
 * `capturePreEditSnapshot` whenever `currentUser.id !== inspector_id`
 * (see `src/pages/InspectionForm.tsx` line ~1750), which resolves to
 * `admin-edit-snapshot::_doCapture` → INSERT into `admin_edit_snapshots`.
 *
 * Flow:
 *   1. Sign in as the OWNER (regular test user) and create an inspection
 *      online with a `[E2E DEVIN] <ts>` marker.
 *   2. Wait for the inspection to reach Supabase, capture its server id.
 *   3. Sign out, sign in as the ADMIN. Capture the admin's session.
 *   4. Open `/inspection/<id>` as the admin. Verify edit access is granted
 *      (the Save button becomes enabled, indicating
 *      `useReportEditPermission` returned `canEdit=true`).
 *   5. Edit the location and click Save Progress. Wait for the edit to
 *      reach Supabase (proves `performSave` actually completed).
 *   6. Poll `admin_edit_snapshots` for a row matching
 *      (report_type='inspection', report_id=<server id>, edited_by=<admin id>,
 *      original_owner_id=<owner id>). Validate `snapshot_data.parent` and
 *      `snapshot_data.children` are present.
 *   7. Post-flight: delete the test inspection. Admin-edit-snapshot rows
 *      cannot be deleted by admin role (RLS DELETE is super-admin only,
 *      preserving audit-trail integrity), so we leave them in place and
 *      rely on each run's unique report_id to avoid cross-run collisions.
 *
 * RLS dependency: this spec relies on the policies introduced in
 * migration `20260427131652_admin-edit-snapshots-allow-admins-insert.sql`.
 * Without that migration, INSERT into `admin_edit_snapshots` is rejected
 * for admin-role users and the spec deadlocks waiting for a row that
 * will never appear. (See PR description for the production-side bug
 * that motivated the fix.)
 *
 * Requires four secrets:
 *   - E2E_TEST_EMAIL / E2E_TEST_PASSWORD       — the OWNER (regular user)
 *   - E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD     — the ADMIN (admin role,
 *     NOT super_admin: super-admins are strictly read-only per
 *     useReportEditPermission and cannot trigger the snapshot path)
 * The describe is skipped without them so CI on machines lacking the
 * secrets doesn't spuriously fail.
 */

const OWNER_EMAIL = process.env.E2E_TEST_EMAIL;
const OWNER_PASSWORD = process.env.E2E_TEST_PASSWORD;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.describe('admin pre-edit override: snapshot captured on admin save', () => {
  test.skip(
    !OWNER_EMAIL || !OWNER_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'Skipping admin pre-edit override e2e: set E2E_TEST_EMAIL/PASSWORD and ' +
      'E2E_ADMIN_EMAIL/PASSWORD to run.'
  );

  // Two full sign-in flows + warmup + create + cloud round-trip + form load
  // + edit + cloud round-trip + admin_edit_snapshots oracle + cleanup. CI
  // runners see ~3-5x the Supabase round-trip latency seen locally; budget
  // raised to 300s when create-wait was bumped to 180s, then to 480s when
  // the snapshot-row wait was bumped to 180s (line ~250) to accommodate
  // the same upstream fetch flake. With three serial 120-180s waits plus
  // setup/save/cleanup, 300s could clip a slow-but-passing run.
  test.setTimeout(480_000);

  test('owner creates inspection → admin edits → admin_edit_snapshots row exists', async ({
    page,
  }) => {
    const uncaught: Error[] = [];
    page.on('pageerror', (err) => {
      // Lazy-chunk fetch failures while online aren't expected, but match
      // the filter used by sibling specs so a transient SW miss doesn't
      // trip the assertion at the end.
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

    // Resources that may need explicit cleanup even when test.skip()
    // throws mid-body. Declared with `let` so the `finally` block below
    // can dispose them conditionally regardless of which step aborted.
    let ownerSession: SupabaseTestSession | undefined;
    let adminSession: SupabaseTestSession | undefined;
    let ownerCleanupSession: SupabaseTestSession | undefined;

    try {
    // ── 1. Sign in as OWNER ──────────────────────────────────────────────
    await signIn(page, { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    ownerSession = await captureSupabaseSession(page);

    // Pre-flight cleanup of any `[E2E DEVIN]` inspections left over from
    // a previously-failed run — RLS allows the owner to delete their own.
    const purgedBefore = await purgeMarkedInspections(ownerSession);
    if (purgedBefore > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[e2e cleanup] removed ${purgedBefore} stale [E2E DEVIN] inspections`
      );
    }

    // ── 1b. Warmup: dashboard + first autosync settle ────────────────────
    // The very first navigation on a cold browser context eats SW install,
    // first JWT mint, and the first autosync tick all at once. Visiting
    // /dashboard before /inspection/new lets that cold-start cost amortise
    // outside the cloud-poll budget below. We wait for the dashboard list
    // to render rather than just `goto`, so the autosync hook has actually
    // had a chance to fire its first cycle. Best-effort — if the dashboard
    // copy changes we don't want to fail the spec, just lose the warmup.
    await page.goto('/dashboard');
    await page
      .getByText(/inspections|trainings|daily assessments|no reports/i)
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {
        /* best-effort warmup */
      });

    // ── 2. Create inspection ONLINE as OWNER ─────────────────────────────
    await page.goto('/inspection/new');
    await expect(
      page.getByText(/new inspection report/i).first()
    ).toBeVisible({ timeout: 15_000 });

    const marker = `${MARKER_PREFIX} ${Date.now()}`;
    const markerEdited = `${marker} admin-edit`;

    const orgCombo = page.getByRole('combobox', {
      name: /select or type organization/i,
    });
    await orgCombo.click();
    await orgCombo.fill(marker);
    await page.keyboard.press('Tab');

    await page.getByPlaceholder(/enter location/i).fill(marker);

    await page.getByRole('button', { name: /^create inspection$/i }).click();

    // Wait for the inspection itself to reach Supabase. Budget bumped
    // 120s → 180s to match the same CI-only autosync-latency flake that
    // bit `offline-edit-reconcile` (see PR #25 raise from 60s → 120s on
    // that spec). The admin spec is more sensitive because it runs the
    // create step on a cold context; even with the /dashboard warmup
    // above we keep the extra 60s headroom so transient GH Actions
    // Supabase RTT spikes don't surface as a false RLS-policy bug.
    const createdRow = await waitForInspectionInCloud(ownerSession, marker, {
      timeoutMs: 180_000,
    });
    const serverId = createdRow.id as string;
    expect(serverId, 'created row should have a server id').toBeTruthy();
    const ownerUserId = ownerSession.userId;

    // ── 3. Sign out, sign in as ADMIN ────────────────────────────────────
    await signOut(page);
    await signIn(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminSession = await captureSupabaseSession(page);
    expect(adminSession.userId, 'admin should be a different user than owner')
      .not.toBe(ownerUserId);

    // Probe the live `admin_edit_snapshots` INSERT policy. If migration
    // 20260427131652 hasn't been applied to the live Supabase project
    // yet, the admin role can't INSERT and the spec would otherwise
    // deadlock 60s in `waitForAdminEditSnapshot`. The probe uses
    // `Prefer: tx=rollback` so it never commits a sentinel row. Skipping
    // here is a deployment-state condition, not a code condition — the
    // spec re-activates automatically once the migration ships live.
    const policyState = await probeAdminEditSnapshotInsertPolicy(adminSession);
    test.skip(
      policyState !== 'deployed',
      `admin_edit_snapshots INSERT policy not deployed (probe=${policyState}); ` +
        'apply migration 20260427131652_admin-edit-snapshots-allow-admins-insert.sql ' +
        'to live Supabase to re-enable this spec.'
    );

    // ── 4. Open the inspection form as ADMIN ─────────────────────────────
    await page.goto(`/inspection/${serverId}`);
    const locationInput = page.getByPlaceholder(/enter location/i);
    await expect(locationInput).toBeVisible({ timeout: 30_000 });
    await expect(locationInput).toHaveValue(marker, { timeout: 30_000 });

    // Save Progress button = explicit `saveProgress()` invocation, which
    // routes through `performSave` → `capturePreEditSnapshot` (because
    // currentUser.id !== inspector_id). We use it instead of relying on
    // blur-triggered autosave because (a) autosave is debounced and was
    // observed in CI to silently no-op when the form is mid-hydration,
    // and (b) explicit save is a more deterministic oracle.
    const saveButton = page.getByRole('button', {
      name: /^(save progress|save locally|save)\.{0,3}$/i,
    });

    // ── 5. Edit + save → verify Supabase ─────────────────────────────────
    // Edit-access oracle: if `useReportEditPermission` returns
    // `canEdit=false`, the form renders the input as disabled / read-only
    // and the Save button never enables. Reaching `toBeEnabled` here
    // proves the admin's permission check resolved correctly.
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

    await expect(saveButton.first()).toBeEnabled({ timeout: 30_000 });
    await saveButton.first().click();

    // Wait for the saving spinner to clear — proves performSave's
    // promise resolved (and capturePreEditSnapshot fired).
    await expect(saveButton.first()).toBeEnabled({ timeout: 60_000 });

    // The inspections table allows admin UPDATE via the "Admins can update
    // all inspections" RLS policy (migration 20260326142512). Poll the
    // OWNER's session because the existing helper filters by
    // `inspector_id=eq.{userId}`, which is the owner here even though the
    // edit was made by the admin.
    await waitForInspectionLocationInCloud(ownerSession, {
      id: serverId,
      expectedLocation: markerEdited,
      timeoutMs: 120_000,
    });

    // ── 6. Wait for the admin_edit_snapshots row ─────────────────────────
    // 180s mirrors the location-wait budget bumped at fa86a322 — same
    // upstream Supabase fetch flake on GH Actions runners. The snapshot
    // capture is fire-and-forget at the production-code layer; if its
    // parent fetch hits the flake it falls back to a local IDB queue
    // that drains on the next `useAutoSync` cycle, so the row can take
    // longer than the form's spinner-clear time to land in the cloud.
    const snapshot = await waitForAdminEditSnapshot(adminSession, {
      reportType: 'inspection',
      reportId: serverId,
      editedBy: adminSession.userId,
      originalOwnerId: ownerUserId,
      timeoutMs: 180_000,
    });
    expect(snapshot.report_type).toBe('inspection');
    expect(snapshot.report_id).toBe(serverId);
    expect(snapshot.edited_by).toBe(adminSession.userId);
    expect(snapshot.original_owner_id).toBe(ownerUserId);

    // snapshot_data should contain { parent: <inspection row>, children: { ... } }
    expect(snapshot.snapshot_data).toBeTruthy();
    const data = snapshot.snapshot_data as Record<string, unknown>;
    expect(data.parent, 'snapshot_data.parent missing').toBeTruthy();
    expect(data.children, 'snapshot_data.children missing').toBeTruthy();
    const parent = data.parent as Record<string, unknown>;
    // The captured parent should reflect the PRE-edit server state: the
    // location should be the original marker, NOT the post-edit value
    // (the snapshot is taken from the server BEFORE the admin's UPDATE
    // commits).
    expect(parent.location).toBe(marker);
    expect(parent.inspector_id).toBe(ownerUserId);

    // ── 7. Post-flight cleanup ──────────────────────────────────────────
    // Sign back in as the owner so we can DELETE the inspection (RLS only
    // grants DELETE to the owner or super_admin, not generic admin role).
    await signOut(page);
    await signIn(page, { email: OWNER_EMAIL, password: OWNER_PASSWORD });
    ownerCleanupSession = await captureSupabaseSession(page);
    const purgedAfter = await purgeMarkedInspections(ownerCleanupSession);
    // eslint-disable-next-line no-console
    console.log(
      `[e2e cleanup] post-flight: removed ${purgedAfter} [E2E DEVIN] inspections`
    );

    // No uncaught page errors should have leaked (filtered above).
    expect(
      uncaught,
      `uncaught page errors: ${uncaught.map((e) => e.message).join('; ')}`
    ).toEqual([]);
    } finally {
      // Always dispose APIRequestContexts opened via `request.newContext()`,
      // including when `test.skip()` aborts the test mid-body. Without
      // this, the deployment-state skip path leaks file descriptors /
      // sockets for the remainder of the worker process. The orphaned
      // inspection (if any) is collected by the next run's pre-flight
      // `purgeMarkedInspections` call.
      await ownerSession?.apiClient.dispose();
      await adminSession?.apiClient.dispose();
      await ownerCleanupSession?.apiClient.dispose();
    }
  });
});
