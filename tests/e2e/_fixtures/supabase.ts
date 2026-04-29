import { type APIRequestContext, type Page, request } from '@playwright/test';

/**
 * Helpers for talking to the Supabase REST API directly from Playwright
 * tests, bypassing the in-browser app. Used for:
 *
 *   - Pre-flight cleanup: delete any prior `[E2E DEVIN]`-marked
 *     inspections/trainings/assessments belonging to the test user before
 *     a spec runs, so a previously-failed run doesn't leak garbage forward.
 *   - Post-flight cleanup: delete the row(s) the spec created.
 *   - Cloud-side verification: poll until the offline-created row has
 *     reconciled to the server, which is a far cleaner sync-completion
 *     signal than scraping the in-app status indicator or polling IDB.
 *
 * RLS already constrains every call to the test user's own rows, so no
 * service-role key is needed. The marker prefix below is the test
 * identity — anything matching it can be safely wiped.
 *
 * Marker convention: every test inspection's `course_location` (and where
 * applicable, organization) starts with `MARKER_PREFIX`. Scope C uses
 * `[E2E DEVIN] <timestamp>` so concurrent runs don't collide.
 */

export const MARKER_PREFIX = '[E2E DEVIN]';

export interface SupabaseTestSession {
  jwt: string;
  userId: string;
  apiClient: APIRequestContext;
  baseURL: string;
  anonKey: string;
}

interface AuthTokenShape {
  access_token: string;
  user?: { id?: string };
}

/**
 * Pull the live Supabase session out of the page's localStorage. Supabase
 * stores it under `sb-{ref}-auth-token`. We don't hard-code the ref so this
 * works against any project the test points at.
 */
async function readAuthToken(page: Page): Promise<AuthTokenShape | null> {
  return page.evaluate<AuthTokenShape | null>(() => {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) return null;
          return JSON.parse(raw) as AuthTokenShape;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
}

/**
 * After the test user has signed into the page, capture their JWT and a
 * pre-configured APIRequestContext that will hit Supabase REST with the
 * right auth headers. Throws if the page isn't actually signed in.
 */
export async function captureSupabaseSession(
  page: Page
): Promise<SupabaseTestSession> {
  const baseURL = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!baseURL || !anonKey) {
    throw new Error(
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be available ' +
        'in process.env. playwright.config.ts loads them via Vite\'s loadEnv.'
    );
  }

  const token = await readAuthToken(page);
  if (!token?.access_token) {
    throw new Error(
      'No Supabase session found in localStorage. Did the page actually sign in?'
    );
  }
  const userId = token.user?.id;
  if (!userId) {
    throw new Error(
      'Supabase session is missing user.id. Test cannot scope cleanup to a single user.'
    );
  }

  const apiClient = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      apikey: anonKey,
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  return {
    jwt: token.access_token,
    userId,
    apiClient,
    baseURL,
    anonKey,
  };
}

/**
 * Hard-delete every inspection whose course_location starts with the marker
 * prefix and belongs to the current test user. Best-effort — never throws
 * even on a 4xx, since cleanup is opportunistic.
 *
 * Note: We use real DELETE rather than soft-delete (deleted_at) so leftover
 * test rows don't accumulate forever in the soft-deleted index. RLS allows
 * the test user to delete their own rows on `inspections`.
 */
export async function purgeMarkedInspections(
  session: SupabaseTestSession
): Promise<number> {
  const url = `/rest/v1/inspections?location=ilike.${encodeURIComponent(
    MARKER_PREFIX + '%'
  )}&inspector_id=eq.${session.userId}`;
  try {
    const res = await session.apiClient.delete(url, {
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok()) {
      // Cleanup must never block a test run.
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e cleanup] purge returned ${res.status()} ${res.statusText()}`
      );
      return 0;
    }
    const body = (await res.json().catch(() => [])) as unknown[];
    return Array.isArray(body) ? body.length : 0;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e cleanup] purge threw:', err);
    return 0;
  }
}

/**
 * Wait until the server can see at least one inspection matching the given
 * unique marker. Returns the matching row. Throws if the timeout elapses.
 *
 * Used as the "sync completed" oracle for offline-created records: once
 * the local autoSync hook has flushed the queued create to the cloud,
 * this query returns it.
 */
export async function waitForInspectionInCloud(
  session: SupabaseTestSession,
  uniqueMarker: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const url = `/rest/v1/inspections?location=eq.${encodeURIComponent(
    uniqueMarker
  )}&inspector_id=eq.${session.userId}&select=*&limit=1`;
  const deadline = Date.now() + timeoutMs;
  let last: { status: number; body: string } | null = null;
  while (Date.now() < deadline) {
    const res = await session.apiClient.get(url);
    if (res.ok()) {
      const rows = (await res.json()) as Record<string, unknown>[];
      if (Array.isArray(rows) && rows.length > 0) return rows[0];
    } else {
      last = { status: res.status(), body: await res.text() };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for inspection with location=${uniqueMarker}` +
      (last ? ` (last response: ${last.status} ${last.body})` : '')
  );
}

/**
 * Hard-delete every `report_cloud_backups` row whose `facility` starts with
 * the marker prefix and belongs to the current test user. Best-effort —
 * never throws even on a 4xx, since cleanup is opportunistic.
 *
 * `facility` is set from `snapshot.parent.organization` at upload time
 * (see `cloud-backup.ts::_doUpload`), so any inspection created with the
 * `[E2E DEVIN] …` org marker will produce backup rows that match.
 *
 * RLS allows users to delete their own backups; no service-role key is
 * needed.
 */
export async function purgeMarkedCloudBackups(
  session: SupabaseTestSession
): Promise<number> {
  const url = `/rest/v1/report_cloud_backups?facility=ilike.${encodeURIComponent(
    MARKER_PREFIX + '%'
  )}&user_id=eq.${session.userId}`;
  try {
    const res = await session.apiClient.delete(url, {
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e cleanup] cloud-backup purge returned ${res.status()} ${res.statusText()}`
      );
      return 0;
    }
    const body = (await res.json().catch(() => [])) as unknown[];
    return Array.isArray(body) ? body.length : 0;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e cleanup] cloud-backup purge threw:', err);
    return 0;
  }
}

interface CloudBackupRow {
  id: string;
  user_id: string;
  report_type: string;
  report_id: string;
  device: string;
  synced: boolean;
  snapshot_ts: number;
  facility: string | null;
  created_at: string;
}

/**
 * Wait until `report_cloud_backups` contains a row for the given
 * (`reportType`, `reportId`) belonging to the current test user. Returns
 * the matching row. Throws if the timeout elapses.
 *
 * Used as the "cloud-backup auto-upload completed" oracle: every save in
 * the form path fires `local-backup-ledger::saveReportSnapshot`, which
 * fire-and-forget calls `cloud-backup::uploadSnapshotToCloud`. This poll
 * is the cleanest signal that the upload landed.
 */
export async function waitForCloudBackup(
  session: SupabaseTestSession,
  opts: {
    reportType: string;
    reportId: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<CloudBackupRow> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const url =
    `/rest/v1/report_cloud_backups` +
    `?report_type=eq.${encodeURIComponent(opts.reportType)}` +
    `&report_id=eq.${encodeURIComponent(opts.reportId)}` +
    `&user_id=eq.${session.userId}` +
    `&select=id,user_id,report_type,report_id,device,synced,snapshot_ts,facility,created_at` +
    `&limit=1`;
  const deadline = Date.now() + timeoutMs;
  let last: { status: number; body: string } | null = null;
  while (Date.now() < deadline) {
    const res = await session.apiClient.get(url);
    if (res.ok()) {
      const rows = (await res.json()) as CloudBackupRow[];
      if (Array.isArray(rows) && rows.length > 0) return rows[0];
    } else {
      last = { status: res.status(), body: await res.text() };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for cloud-backup row ` +
      `(report_type=${opts.reportType}, report_id=${opts.reportId})` +
      (last ? ` (last response: ${last.status} ${last.body})` : '')
  );
}

/**
 * Wait until the cloud-backup row for (`reportType`, `reportId`) has a
 * `snapshot_ts` strictly greater than `afterTs`. Returns the matching row.
 * Throws if the timeout elapses.
 *
 * Used as the "second auto-upload after edit" oracle: after editing the
 * inspection, the next save fires another upload which upserts onto the
 * same `(user_id, report_type, report_id)` row — only `snapshot_ts`
 * changes. Polling for the timestamp ratchet is the cleanest signal that
 * the post-edit upload landed (vs. e.g. polling the facility field, which
 * doesn't change unless org changes).
 */
export async function waitForCloudBackupTsAdvance(
  session: SupabaseTestSession,
  opts: {
    reportType: string;
    reportId: string;
    afterTs: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<CloudBackupRow> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const url =
    `/rest/v1/report_cloud_backups` +
    `?report_type=eq.${encodeURIComponent(opts.reportType)}` +
    `&report_id=eq.${encodeURIComponent(opts.reportId)}` +
    `&user_id=eq.${session.userId}` +
    `&select=id,user_id,report_type,report_id,device,synced,snapshot_ts,facility,created_at` +
    `&limit=1`;
  const deadline = Date.now() + timeoutMs;
  let lastRow: CloudBackupRow | null = null;
  let lastErr: { status: number; body: string } | null = null;
  while (Date.now() < deadline) {
    const res = await session.apiClient.get(url);
    if (res.ok()) {
      const rows = (await res.json()) as CloudBackupRow[];
      if (Array.isArray(rows) && rows.length > 0) {
        lastRow = rows[0];
        if (lastRow.snapshot_ts > opts.afterTs) return lastRow;
      }
    } else {
      lastErr = { status: res.status(), body: await res.text() };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for cloud-backup snapshot_ts to advance ` +
      `past ${opts.afterTs} (report_type=${opts.reportType}, report_id=${opts.reportId})` +
      (lastRow
        ? ` (last observed snapshot_ts=${lastRow.snapshot_ts})`
        : '') +
      (lastErr ? ` (last response: ${lastErr.status} ${lastErr.body})` : '')
  );
}

/**
 * Wait until the server sees a specific inspection (`id`) whose `location`
 * equals `expectedLocation`. Returns the matching row. Throws if the
 * timeout elapses.
 *
 * Used as the "sync completed" oracle for offline EDITS: the row already
 * exists on the server, we're waiting for the autoSync hook to flush the
 * edit to a known value.
 */
export async function waitForInspectionLocationInCloud(
  session: SupabaseTestSession,
  opts: {
    id: string;
    expectedLocation: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const url = `/rest/v1/inspections?id=eq.${encodeURIComponent(
    opts.id
  )}&inspector_id=eq.${session.userId}&select=*&limit=1`;
  const deadline = Date.now() + timeoutMs;
  let lastRow: Record<string, unknown> | null = null;
  let lastErr: { status: number; body: string } | null = null;
  while (Date.now() < deadline) {
    const res = await session.apiClient.get(url);
    if (res.ok()) {
      const rows = (await res.json()) as Record<string, unknown>[];
      if (Array.isArray(rows) && rows.length > 0) {
        lastRow = rows[0];
        if (lastRow.location === opts.expectedLocation) return lastRow;
      }
    } else {
      lastErr = { status: res.status(), body: await res.text() };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for inspection ${opts.id} ` +
      `location to become '${opts.expectedLocation}'` +
      (lastRow
        ? ` (last observed location='${String(lastRow.location)}')`
        : '') +
      (lastErr ? ` (last response: ${lastErr.status} ${lastErr.body})` : '')
  );
}

interface AdminEditSnapshotRow {
  id: string;
  report_type: string;
  report_id: string;
  original_owner_id: string;
  edited_by: string;
  snapshot_data: unknown;
  created_at: string;
}

/**
 * Hard-delete every `admin_edit_snapshots` row for the given (`reportType`,
 * `reportId`). Best-effort — never throws on a 4xx, since cleanup is
 * opportunistic.
 *
 * IMPORTANT: caller must use a **super_admin** session. The only
 * DELETE-granting policy on `admin_edit_snapshots` is the original
 * "Super admins can manage" `FOR ALL` policy gated on `is_super_admin()`.
 * The admin-role policies added in migration 20260427131652 cover only
 * INSERT and SELECT — NOT DELETE — to preserve audit-trail integrity.
 * Calling this with an admin or owner session will get RLS-rejected,
 * log a warning, and return 0.
 *
 * In practice the e2e suite has no super_admin test session, so this
 * helper is a no-op in CI and is provided only for local repro / future
 * use if a super-admin fixture is added.
 */
export async function purgeAdminEditSnapshotsForReport(
  superAdminSession: SupabaseTestSession,
  opts: { reportType: string; reportId: string }
): Promise<number> {
  const url =
    `/rest/v1/admin_edit_snapshots` +
    `?report_type=eq.${encodeURIComponent(opts.reportType)}` +
    `&report_id=eq.${encodeURIComponent(opts.reportId)}`;
  try {
    const res = await superAdminSession.apiClient.delete(url, {
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e cleanup] admin-edit-snapshot purge returned ${res.status()} ${res.statusText()}`
      );
      return 0;
    }
    const body = (await res.json().catch(() => [])) as unknown[];
    return Array.isArray(body) ? body.length : 0;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e cleanup] admin-edit-snapshot purge threw:', err);
    return 0;
  }
}

/**
 * Result of probing whether the live Supabase project has migration
 * `20260427131652_admin-edit-snapshots-allow-admins-insert.sql` applied.
 *
 * The migration adds a `FOR INSERT ... WITH CHECK (is_admin_or_above())`
 * policy to `admin_edit_snapshots`. Without it, the only INSERT-granting
 * policy is `is_super_admin()`, so admin-role users cannot capture
 * snapshots and the e2e spec deadlocks waiting for a row that will never
 * appear (see PR #31 for the production-side bug).
 *
 * Possible states:
 *   - 'deployed'   — INSERT succeeds (or fails for non-RLS reasons such as
 *                    a uuid format error, NOT NULL violation, etc).
 *                    The probe rolls back via `Prefer: tx=rollback` so no
 *                    sentinel row is committed. Spec runs.
 *   - 'not_deployed' — INSERT returns 403/401 with PostgREST code `42501`
 *                    and a message containing "row-level security". Spec
 *                    skips with a clear message instead of timing out.
 *   - 'unknown'    — Probe got an unexpected HTTP shape (network error,
 *                    5xx, JSON parse failure). Spec skips defensively, on
 *                    the principle that we'd rather skip an indeterminate
 *                    state than spend 60-120s timing out.
 */
export type AdminEditSnapshotPolicyState =
  | 'deployed'
  | 'not_deployed'
  | 'unknown';

/**
 * Probe whether the admin-INSERT policy on `admin_edit_snapshots` is live
 * in the Supabase project the spec is currently pointed at.
 *
 * Mechanics:
 *   - Fires a single REST INSERT with all required NOT-NULL columns
 *     populated (so the only thing that can reject it is RLS), but with
 *     `Prefer: tx=rollback,return=minimal` so the row is never committed
 *     even on success. PostgREST 11+ supports `tx=rollback`.
 *   - Sentinel `report_id` / `original_owner_id` use a fixed all-zeros
 *     UUID just to keep the values inspectable in any logs that might
 *     leak through; nothing in the row is committed.
 *   - HTTP 201 → 'deployed'. PostgREST returns 201 even on a rolled-back
 *     INSERT.
 *   - HTTP 403/401 with body containing the RLS error → 'not_deployed'.
 *   - Anything else → 'unknown'.
 *
 * Caller must use the **admin** session (the one whose `is_admin_or_above()`
 * check is what we're verifying). A super-admin or owner session will
 * give a misleading answer because their policies are different.
 */
export async function probeAdminEditSnapshotInsertPolicy(
  adminSession: SupabaseTestSession
): Promise<AdminEditSnapshotPolicyState> {
  const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
  const body = {
    report_type: 'inspection',
    report_id: ZERO_UUID,
    original_owner_id: ZERO_UUID,
    edited_by: adminSession.userId,
    snapshot_data: { probe: true },
  };
  try {
    const res = await adminSession.apiClient.post(
      '/rest/v1/admin_edit_snapshots',
      {
        headers: {
          'Content-Type': 'application/json',
          // tx=rollback guarantees no committed sentinel row even on
          // success; return=minimal keeps the response body small.
          Prefer: 'tx=rollback,return=minimal',
        },
        data: body,
      }
    );
    if (res.status() === 201 || res.status() === 200) {
      return 'deployed';
    }
    const text = await res.text().catch(() => '');
    if (
      (res.status() === 401 || res.status() === 403) &&
      /row-level security/i.test(text)
    ) {
      return 'not_deployed';
    }
    // Anything else — log for diagnostic but treat as unknown.
    // eslint-disable-next-line no-console
    console.warn(
      `[admin-edit-snapshot policy probe] unexpected ${res.status()} ${res.statusText()}: ${text.slice(
        0,
        200
      )}`
    );
    return 'unknown';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[admin-edit-snapshot policy probe] threw:', err);
    return 'unknown';
  }
}

/**
 * Wait until `admin_edit_snapshots` contains a row matching the given
 * (`reportType`, `reportId`, `editedBy`). Returns the matching row.
 * Throws if the timeout elapses.
 *
 * Used as the "admin pre-edit snapshot was captured" oracle: when an
 * admin saves a report owned by another user, `InspectionForm.performSave`
 * fires `capturePreEditSnapshot` → `_doCapture` → INSERT here.
 *
 * Caller can use either an admin session (SELECT policy added in migration
 * 20260427131652 grants admin-role read) or an owner session
 * (`original_owner_id = auth.uid()` SELECT policy from the original table
 * migration).
 */
export async function waitForAdminEditSnapshot(
  session: SupabaseTestSession,
  opts: {
    reportType: string;
    reportId: string;
    editedBy: string;
    originalOwnerId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<AdminEditSnapshotRow> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const params =
    `report_type=eq.${encodeURIComponent(opts.reportType)}` +
    `&report_id=eq.${encodeURIComponent(opts.reportId)}` +
    `&edited_by=eq.${encodeURIComponent(opts.editedBy)}` +
    (opts.originalOwnerId
      ? `&original_owner_id=eq.${encodeURIComponent(opts.originalOwnerId)}`
      : '') +
    `&select=id,report_type,report_id,original_owner_id,edited_by,snapshot_data,created_at` +
    `&order=created_at.desc&limit=1`;
  const url = `/rest/v1/admin_edit_snapshots?${params}`;
  const deadline = Date.now() + timeoutMs;
  let last: { status: number; body: string } | null = null;
  while (Date.now() < deadline) {
    const res = await session.apiClient.get(url);
    if (res.ok()) {
      const rows = (await res.json()) as AdminEditSnapshotRow[];
      if (Array.isArray(rows) && rows.length > 0) return rows[0];
    } else {
      last = { status: res.status(), body: await res.text() };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for admin_edit_snapshots row ` +
      `(report_type=${opts.reportType}, report_id=${opts.reportId}, ` +
      `edited_by=${opts.editedBy})` +
      (last ? ` (last response: ${last.status} ${last.body})` : '')
  );
}

interface InspectionPhotoRow {
  id: string;
  inspection_id: string;
  photo_url: string;
  photo_section: string | null;
  caption: string | null;
  display_order: number | null;
  created_at: string | null;
  deleted_at: string | null;
}

/**
 * Wait until `inspection_photos` contains at least one row for the given
 * inspection. Returns the matching row. Throws on timeout.
 *
 * Used as the "photo upload completed" oracle for `PhotoCapture`'s
 * fire-and-forget background sync (`uploadPhotoInBackground` in
 * `src/components/PhotoCapture.tsx`). Once the upload succeeds the row is
 * inserted with `inspection_id`, `photo_url` (storage path), and
 * `photo_section` populated.
 *
 * Filters out soft-deleted rows so the same inspection can be re-used
 * across spec iterations without false positives.
 */
export async function waitForInspectionPhotoInCloud(
  session: SupabaseTestSession,
  opts: {
    inspectionId: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    section?: string;
  }
): Promise<InspectionPhotoRow> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const sectionFilter = opts.section
    ? `&photo_section=eq.${encodeURIComponent(opts.section)}`
    : '';
  const url =
    `/rest/v1/inspection_photos` +
    `?inspection_id=eq.${encodeURIComponent(opts.inspectionId)}` +
    `&deleted_at=is.null` +
    sectionFilter +
    `&select=*&order=created_at.desc&limit=1`;
  const deadline = Date.now() + timeoutMs;
  let last: { status: number; body: string } | null = null;
  while (Date.now() < deadline) {
    const res = await session.apiClient.get(url);
    if (res.ok()) {
      const rows = (await res.json()) as InspectionPhotoRow[];
      if (Array.isArray(rows) && rows.length > 0) return rows[0];
    } else {
      last = { status: res.status(), body: await res.text() };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for inspection_photos row ` +
      `(inspection_id=${opts.inspectionId}` +
      (opts.section ? `, photo_section=${opts.section}` : '') +
      `)` +
      (last ? ` (last response: ${last.status} ${last.body})` : '')
  );
}

/**
 * Best-effort fetch of storage paths (`photo_url`) for every
 * `inspection_photos` row tied to the given inspection. Used to drive
 * storage-object cleanup BEFORE the parent inspection is deleted (the
 * `inspection_photos` row is FK-cascaded away on inspection delete, but
 * the underlying object in the `inspection-photos` storage bucket is NOT
 * cascaded — it has to be removed via the storage API).
 *
 * Returns `[]` on any failure so cleanup never blocks a test run.
 */
export async function getInspectionPhotoStoragePaths(
  session: SupabaseTestSession,
  inspectionId: string
): Promise<string[]> {
  const url =
    `/rest/v1/inspection_photos?inspection_id=eq.${encodeURIComponent(inspectionId)}` +
    `&select=photo_url`;
  try {
    const res = await session.apiClient.get(url);
    if (!res.ok()) return [];
    const rows = (await res.json()) as { photo_url: string }[];
    return rows.map((r) => r.photo_url).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Best-effort delete of objects from the `inspection-photos` storage
 * bucket. Mirrors what `supabase.storage.from('inspection-photos').remove(paths)`
 * does: a single `DELETE /storage/v1/object/inspection-photos` with body
 * `{ prefixes: [...] }`. RLS on `storage.objects` allows the test user to
 * delete their own captures (the storage path begins with their userId,
 * see `PhotoCapture.tsx:174`).
 *
 * Returns the number of objects the server reports as deleted; `0` on
 * any failure so cleanup never blocks a test run.
 */
export async function purgeInspectionPhotoStorageObjects(
  session: SupabaseTestSession,
  paths: string[],
  bucket: string = 'inspection-photos'
): Promise<number> {
  if (paths.length === 0) return 0;
  try {
    const res = await session.apiClient.delete(
      `/storage/v1/object/${bucket}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { prefixes: paths },
      }
    );
    if (!res.ok()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e cleanup] storage purge returned ${res.status()} ${res.statusText()} ` +
          `for ${paths.length} path(s)`
      );
      return 0;
    }
    const body = (await res.json().catch(() => [])) as unknown[];
    return Array.isArray(body) ? body.length : 0;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e cleanup] storage purge threw:', err);
    return 0;
  }
}

/**
 * Combined cleanup helper: walk every `[E2E DEVIN]`-marked inspection
 * still owned by the test user, collect their `inspection_photos` storage
 * paths, and DELETE those objects from the bucket. Does NOT delete the
 * `inspection_photos` rows themselves (those FK-cascade away when
 * `purgeMarkedInspections` removes the parent).
 *
 * Best-effort — never throws. Returns the number of storage objects
 * removed so callers can log progress.
 */
export async function purgeMarkedInspectionPhotoStorageObjects(
  session: SupabaseTestSession
): Promise<number> {
  const markedUrl =
    `/rest/v1/inspections?location=ilike.${encodeURIComponent(
      MARKER_PREFIX + '%'
    )}&inspector_id=eq.${session.userId}&select=id`;
  let inspectionIds: string[] = [];
  try {
    const res = await session.apiClient.get(markedUrl);
    if (!res.ok()) return 0;
    const rows = (await res.json()) as { id: string }[];
    inspectionIds = rows.map((r) => r.id).filter(Boolean);
  } catch {
    return 0;
  }
  if (inspectionIds.length === 0) return 0;

  const allPaths: string[] = [];
  for (const id of inspectionIds) {
    const paths = await getInspectionPhotoStoragePaths(session, id);
    allPaths.push(...paths);
  }
  if (allPaths.length === 0) return 0;
  return purgeInspectionPhotoStorageObjects(session, allPaths);
}
