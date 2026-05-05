/**
 * Hide records produced by the Playwright e2e suite from the production UI.
 *
 * The e2e suite stamps every fixture record's identifier columns with
 * `MARKER_PREFIX` (currently `[E2E DEVIN]`) so post-flight cleanup can do
 * RLS-scoped deletes safely. When a spec fails before reaching its cleanup
 * (e.g. the historical offline-edit-reconcile flake series), the marked
 * rows linger in production and surface to admin users whose RLS view
 * spans all inspectors.
 *
 * The right long-term fix is a separate Supabase project for e2e, but
 * until that's provisioned this filter keeps test residue out of the
 * dashboard so admins don't have to reason about what's "real".
 *
 * The filter is defense-in-depth and applies at two layers:
 *   1. Server query: `.not('<col>', 'ilike', '[E2E DEVIN]%')` so leaked
 *      rows never enter the client.
 *   2. Client-side guard: `filterOutE2EFixtures(rows, ...)` for any
 *      offline/IDB-sourced array that bypasses the server filter.
 *
 * The helper is intentionally narrow — it does NOT filter rows authored
 * by the e2e test user account itself, since that account may also be
 * used for legitimate manual QA. Only marker-prefixed rows are hidden.
 */
export const E2E_MARKER_PREFIX = '[E2E DEVIN]';

/**
 * Lower-cased prefix used by `isE2EFixtureRecord` for case-insensitive
 * comparison (mirrors PostgREST `ilike` semantics on the server).
 */
const LOWER_PREFIX = E2E_MARKER_PREFIX.toLowerCase();

type Row = Record<string, unknown>;

/**
 * Returns true if any of the provided columns on `row` is a string that
 * (case-insensitively) starts with the marker prefix.
 */
export function isE2EFixtureRecord<T extends Row>(
  row: T | null | undefined,
  columns: readonly (keyof T & string)[]
): boolean {
  if (!row) return false;
  for (const col of columns) {
    const v = row[col];
    if (typeof v === 'string' && v.toLowerCase().startsWith(LOWER_PREFIX)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns a new array with marker-prefixed rows removed.
 */
export function filterOutE2EFixtures<T extends Row>(
  rows: readonly T[],
  columns: readonly (keyof T & string)[]
): T[] {
  return rows.filter((r) => !isE2EFixtureRecord(r, columns));
}

/**
 * Default columns the e2e suite stamps on inspection records. Used by
 * Dashboard + SuperAdminDashboard inspection list filters. Both columns
 * are required because some specs only stamp `location`, while others
 * also stamp `organization`.
 */
export const E2E_INSPECTION_MARKER_COLUMNS = ['location', 'organization'] as const;
