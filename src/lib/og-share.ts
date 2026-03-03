/**
 * OG Share Utilities
 * Constructs shareable URLs that produce rich previews on Twitter/Slack/etc.
 * Uses short hashes (8 hex chars) instead of full UUIDs for security.
 */

type ReportType = 'inspection' | 'training' | 'daily_assessment';
type OgSize = 'og' | 'twitter';

/**
 * Derive an 8-char hex hash from a UUID (strips dashes, takes first 8 chars)
 */
function toShortHash(uuid: string): string {
  return uuid.replace(/-/g, '').substring(0, 8).toLowerCase();
}

/**
 * Get the base URL for edge functions
 */
function getFunctionsBaseUrl(): string {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1`;
}

/**
 * Get a shareable URL that serves OG meta tags for social crawlers
 * and redirects real users back to the app.
 */
export function getShareableUrl(reportType: ReportType, reportId: string): string {
  const hash = toShortHash(reportId);
  return `${getFunctionsBaseUrl()}/og-meta?type=${reportType}&id=${hash}`;
}

/**
 * Get a direct URL to the dynamically generated OG image
 */
export function getOgImageUrl(
  reportType: ReportType,
  reportId: string,
  size: OgSize = 'og'
): string {
  const hash = toShortHash(reportId);
  return `${getFunctionsBaseUrl()}/generate-og-image?type=${reportType}&id=${hash}&size=${size}`;
}

/**
 * Copy the shareable URL to clipboard
 * Returns true on success
 */
export async function copyShareLink(
  reportType: ReportType,
  reportId: string
): Promise<boolean> {
  try {
    const url = getShareableUrl(reportType, reportId);
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
