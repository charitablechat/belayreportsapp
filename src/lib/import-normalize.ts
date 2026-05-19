/**
 * Pure helpers for the "create new Inspection from old report" import flow.
 *
 * Used by src/pages/NewInspection.tsx after parse-inspection-docx returns.
 * Kept pure (no React, no IO) so the regression tests can cover them
 * directly.
 */

export interface ImportedSummary {
  repairs_performed?: string;
  critical_actions?: string;
  future_considerations?: string;
  next_inspection_date?: string;
}

export interface ImportedSystem {
  name?: string;
  system_name?: string;
  result?: string;
  comments?: string;
}

export interface ImportedZipline {
  zipline_name: string;
  cable_type?: string;
  cable_length?: number;
  braking_system?: string;
  ead_system?: string;
  load_tension?: number;
  unload_tension?: number;
  result?: string;
  comments?: string;
}

export interface ImportedHeader {
  // The actual date the uploaded report was performed (cover-page date).
  report_inspection_date?: string | null;
  // The value the uploaded report listed under its own "Previous Inspection
  // Date" field. Should only be used as a fallback.
  previous_inspection_date?: string | null;
}

export interface ImportedChildData {
  systems: ImportedSystem[];
  ziplines: ImportedZipline[];
  // Anything else is forwarded untouched.
  [k: string]: unknown;
}

/**
 * Maps the header data returned by the parser onto the
 * "Previous Inspection Date" field of the NEW report being created.
 *
 * Priority:
 *   1. The uploaded report's actual report/inspection date
 *      (because that report is now the previous inspection).
 *   2. The uploaded report's own "Previous Inspection Date" field
 *      (legacy fallback when the actual date can't be extracted).
 *   3. Whatever value the form already has.
 */
export function mapImportedPreviousInspectionDate(
  data: ImportedHeader,
  currentValue: string,
): string {
  const candidate = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return (
    candidate(data.report_inspection_date) ??
    candidate(data.previous_inspection_date) ??
    currentValue
  );
}

const ZIPLINE_NAME_RE = /zip[\s\-_]?line/i;

const norm = (v: unknown) =>
  typeof v === "string" ? v.trim().toLowerCase() : "";

const looksLikeZipline = (s: ImportedSystem): boolean => {
  return ZIPLINE_NAME_RE.test(s.name || "") ||
    ZIPLINE_NAME_RE.test(s.system_name || "");
};

/**
 * Removes ziplines that the parser mistakenly emitted under generic
 * `systems` (the "Other Elements" section). Behavior:
 *
 *   - If a system entry's name/system_name matches the zipline regex AND
 *     a zipline with the same case-insensitive name already exists, drop it.
 *   - If it matches but no matching zipline exists, move it into `ziplines`.
 *   - Dedupe ziplines by case-insensitive trimmed name.
 *   - Non-zipline systems are left alone (Other Elements still works).
 */
export function normalizeImportedChildData<T extends ImportedChildData>(
  data: T,
): T {
  const systems: ImportedSystem[] = Array.isArray(data.systems)
    ? [...data.systems]
    : [];
  const ziplines: ImportedZipline[] = Array.isArray(data.ziplines)
    ? [...data.ziplines]
    : [];

  const existingZiplineNames = new Set(
    ziplines.map((z) => norm(z.zipline_name)),
  );

  const keptSystems: ImportedSystem[] = [];
  for (const sys of systems) {
    if (!looksLikeZipline(sys)) {
      keptSystems.push(sys);
      continue;
    }
    const candidateName = (sys.name?.trim() || sys.system_name?.trim() || "")
      .replace(/\s+/g, " ");
    const key = candidateName.toLowerCase();
    if (key && existingZiplineNames.has(key)) {
      // Duplicate of an existing zipline — drop from Other Elements.
      continue;
    }
    if (!candidateName) {
      // Nothing usable; drop.
      continue;
    }
    ziplines.push({
      zipline_name: candidateName,
      result: sys.result,
      comments: sys.comments,
    });
    existingZiplineNames.add(key);
  }

  // Dedupe ziplines by case-insensitive trimmed name, keeping first occurrence.
  const seen = new Set<string>();
  const dedupedZiplines: ImportedZipline[] = [];
  for (const z of ziplines) {
    const key = norm(z.zipline_name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedupedZiplines.push(z);
  }

  return { ...data, systems: keptSystems, ziplines: dedupedZiplines };
}
