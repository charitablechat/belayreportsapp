/**
 * verifiedWrite — defensive wrappers around Supabase mutations.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase.from(X).update(...).eq(...)` returns `{ data: null, error: null }`
 * when zero rows are affected (e.g. RLS filters out the target row). Components
 * that don't check the affected-row count run their "success" branch, show a
 * "Saved" toast, and the user's edit silently vanishes on the next refetch.
 *
 * Every user-initiated write MUST verify >=1 row returned before reporting success.
 * See memory: mem://security/silent-rls-no-op
 *
 * USAGE
 * -----
 *   import { verifiedUpdate, SilentWriteError } from "@/lib/db/verifiedWrite";
 *
 *   try {
 *     const row = await verifiedUpdate({
 *       table: "app_announcements",
 *       values: { content, updated_by: user.id },
 *       match: { id: announcementId },
 *       returning: "id, content, updated_at",
 *     });
 *     // row is guaranteed non-null
 *   } catch (e) {
 *     if (e instanceof SilentWriteError) {
 *       toast.error("Save blocked — you may not have permission.");
 *     } else {
 *       toast.error("Save failed. Please try again.");
 *     }
 *   }
 */
import { supabase } from "@/integrations/supabase/client";

export class SilentWriteError extends Error {
  table: string;
  match: Record<string, unknown>;
  operation: "update" | "delete" | "upsert" | "insert";

  constructor(
    operation: "update" | "delete" | "upsert" | "insert",
    table: string,
    match: Record<string, unknown>,
  ) {
    super(
      `Silent ${operation} on "${table}" affected 0 rows. ` +
        `Likely RLS denial, missing record, or ownership mismatch. ` +
        `Match: ${JSON.stringify(match)}`,
    );
    this.name = "SilentWriteError";
    this.operation = operation;
    this.table = table;
    this.match = match;
  }
}

type AnyTable = Parameters<typeof supabase.from>[0];

interface BaseArgs {
  table: AnyTable;
  match: Record<string, unknown>;
  /** Columns to return (PostgREST select expression). Default: `"id"`. */
  returning?: string;
}

interface UpdateArgs extends BaseArgs {
  values: Record<string, unknown>;
}

interface DeleteArgs extends BaseArgs {}

interface InsertArgs {
  table: AnyTable;
  values: Record<string, unknown> | Record<string, unknown>[];
  returning?: string;
}

interface UpsertArgs {
  table: AnyTable;
  values: Record<string, unknown> | Record<string, unknown>[];
  onConflict?: string;
  returning?: string;
}

function applyMatch<T extends { eq: (k: string, v: unknown) => T }>(
  q: T,
  match: Record<string, unknown>,
): T {
  let cur = q;
  for (const [k, v] of Object.entries(match)) {
    cur = cur.eq(k, v);
  }
  return cur;
}

/**
 * Update one or more rows. Throws SilentWriteError if zero rows were affected
 * (typically RLS denial). Returns the first affected row.
 */
export async function verifiedUpdate<T = Record<string, unknown>>({
  table,
  values,
  match,
  returning = "id",
}: UpdateArgs): Promise<T> {
  // Dynamic table name + generic values force us through `any` here; the
  // public API is still strongly typed via the function generics.
  const client = supabase as unknown as {
    from: (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (k: string, v: unknown) => unknown;
      };
    };
  };
  const base = client.from(String(table)).update(values);
  const { data, error } = await applyMatch(
    base as unknown as { eq: (k: string, v: unknown) => unknown },
    match,
  )
    // @ts-expect-error - dynamic chain
    .select(returning)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new SilentWriteError("update", String(table), match);
  return data as T;
}

/**
 * Delete one or more rows. Throws SilentWriteError if zero rows were affected.
 */
export async function verifiedDelete<T = Record<string, unknown>>({
  table,
  match,
  returning = "id",
}: DeleteArgs): Promise<T> {
  const client = supabase as unknown as {
    from: (t: string) => {
      delete: () => { eq: (k: string, v: unknown) => unknown };
    };
  };
  const base = client.from(String(table)).delete();
  const { data, error } = await applyMatch(
    base as unknown as { eq: (k: string, v: unknown) => unknown },
    match,
  )
    // @ts-expect-error - dynamic chain
    .select(returning)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new SilentWriteError("delete", String(table), match);
  return data as T;
}

/**
 * Insert a row. Throws SilentWriteError if the insert returned nothing.
 */
export async function verifiedInsert<T = Record<string, unknown>>({
  table,
  values,
  returning = "id",
}: InsertArgs): Promise<T> {
  const client = supabase as unknown as {
    from: (t: string) => {
      insert: (v: unknown) => {
        select: (r: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
      };
    };
  };
  const { data, error } = await client
    .from(String(table))
    .insert(values)
    .select(returning)
    .maybeSingle();

  if (error) throw error as Error;
  if (!data) throw new SilentWriteError("insert", String(table), {});
  return data as T;
}

/**
 * Upsert a row. Throws SilentWriteError on zero affected rows.
 */
export async function verifiedUpsert<T = Record<string, unknown>>({
  table,
  values,
  onConflict,
  returning = "id",
}: UpsertArgs): Promise<T> {
  const client = supabase as unknown as {
    from: (t: string) => {
      upsert: (
        v: unknown,
        opts?: { onConflict?: string },
      ) => {
        select: (r: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
      };
    };
  };
  const { data, error } = await client
    .from(String(table))
    .upsert(values, onConflict ? { onConflict } : undefined)
    .select(returning)
    .maybeSingle();

  if (error) throw error as Error;
  if (!data) throw new SilentWriteError("upsert", String(table), {});
  return data as T;
}

