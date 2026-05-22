/**
 * Timezone-agnostic date helpers.
 *
 * `new Date("YYYY-MM-DD")` is spec-defined to parse as UTC midnight, which
 * shifts to the previous calendar day when rendered in any negative-UTC
 * timezone (e.g. America/Chicago). Always parse date-only strings through
 * `parseLocalYmd` so they render as the user typed them.
 */

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalYmd(value: string | null | undefined): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const m = YMD_RE.exec(value.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(y, mo - 1, d);
  // Reject normalized rollovers (e.g. Feb 30 -> Mar 2)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return undefined;
  }
  return dt;
}

/** Back-compat alias used across the codebase. */
export const parseLocalDate = parseLocalYmd;
