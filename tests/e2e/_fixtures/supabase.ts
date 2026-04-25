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
