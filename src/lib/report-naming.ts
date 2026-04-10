/**
 * Generates a standardized report filename.
 *
 * Convention: "{Organization} {MM-YYYY}.{ext}"
 * Example:   "Acme Corp 03-2024.pdf"
 *
 * Uses only alphanumeric characters, spaces, and hyphens for
 * cross-platform compatibility (Windows, macOS, iOS, Android).
 */
export function formatReportFilename(
  organization: string | undefined,
  reportType: 'inspection' | 'training' | 'daily-assessment',
  extension: 'pdf' | 'html' | 'json' = 'html'
): string {
  const org = sanitizeForFilename(organization || 'Report');
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${org} ${mm}-${yyyy}.${extension}`;
}

/**
 * Generates a standardized report title for the HTML viewer.
 *
 * Convention: "{Type} Report - {Organization} {MM-YYYY}"
 */
export function formatReportTitle(
  organization: string | undefined,
  reportType: 'inspection' | 'training' | 'daily-assessment'
): string {
  const org = (organization || 'Report').trim();
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  const typeLabel =
    reportType === 'inspection'
      ? 'Inspection Report'
      : reportType === 'training'
        ? 'Training Report'
        : 'Daily Assessment';

  return `${typeLabel} - ${org} ${mm}-${yyyy}`;
}

/** Strip characters that are unsafe on common filesystems. */
function sanitizeForFilename(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ');
}
