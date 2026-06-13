/**
 * Shared Report Layout Components
 * ================================
 * This file provides consistent header/footer layouts across all report types.
 * 
 * LOGO PLACEMENT (PDF EXPORT REQUIREMENTS):
 * - HEADER: Both logos on same horizontal line (Belay Reports LEFT, ACCT RIGHT)
 * - FOOTER: NO LOGOS - only page number and disclaimer text
 * 
 * This ensures PDF exports have consistent branding without footer clutter.
 * 
 * PDF RELIABILITY:
 * - Logos are <img> elements (not CSS backgrounds) for maximum PDF support
 * - Uses inline base64 data URIs to guarantee rendering in all environments
 * - Explicit visibility rules prevent print CSS from hiding logos
 */

// Placeholder logo (1x1 transparent PNG) - used as fallback
export const PLACEHOLDER_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Convert array buffer to base64 in chunks to avoid stack overflow
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Module-level cache: logos are fetched once per cold start and reused across warm invocations
let cachedLogos: { belayReports: string; acct: string } | null = null;

// Fetch logos from Supabase storage and convert to base64 data URIs
export async function getLogoBase64(): Promise<{belayReports: string, acct: string}> {
  if (cachedLogos) {
    console.log('[Report Layout] Using cached logos');
    return cachedLogos;
  }

  // L4 / PDF logos: derive base URL from env so a project-ref rotation doesn't
  // silently break PDF logo rendering.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://ssgzcgvygnsrqalisshx.supabase.co';
  const storageBaseUrl = `${supabaseUrl}/storage/v1/object/public/pdf-templates`;
  const belayReportsUrl = `${storageBaseUrl}/belay-reports-logo-embedded.png`;
  const acctUrl = `${storageBaseUrl}/acct-logo-embedded.png`;
  
  console.log('[Report Layout] Fetching logos from storage...');
  
  try {
    const [belayReportsResponse, acctResponse] = await Promise.all([
      fetch(belayReportsUrl),
      fetch(acctUrl)
    ]);
    
    if (belayReportsResponse.ok && acctResponse.ok) {
      const [belayReportsBuffer, acctBuffer] = await Promise.all([
        belayReportsResponse.arrayBuffer(),
        acctResponse.arrayBuffer()
      ]);
      
      const belayReportsBase64 = arrayBufferToBase64(belayReportsBuffer);
      const acctBase64 = arrayBufferToBase64(acctBuffer);
      
      const belayReportsMime = belayReportsResponse.headers.get('content-type') || 'image/png';
      const acctMime = acctResponse.headers.get('content-type') || 'image/png';
      
      console.log('[Report Layout] Successfully loaded logos from storage');
      
      cachedLogos = {
        belayReports: `data:${belayReportsMime};base64,${belayReportsBase64}`,
        acct: `data:${acctMime};base64,${acctBase64}`
      };
      return cachedLogos;
    } else {
      console.error('[Report Layout] Failed to fetch logos:', belayReportsResponse.status, acctResponse.status);
    }
  } catch (error) {
    console.error('[Report Layout] Error fetching logos:', error);
  }
  
  console.warn('[Report Layout] Using placeholder logos');
  return { belayReports: PLACEHOLDER_LOGO, acct: PLACEHOLDER_LOGO };
}

/**
 * Creates the page header with both logos on same line
 * - Belay Reports logo: LEFT aligned
 * - ACCT logo: RIGHT aligned
 * - Both on same horizontal line (flexbox nowrap)
 */
export function createPageHeader(belayReportsLogo: string, acctLogo: string): string {
  // Use table layout for PDF reliability - tables never wrap cells to new rows
  return `
    <div class="page-header">
      <table class="header-logo-table" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="header-cell-left">
            <img src="${belayReportsLogo}" alt="Belay Reports" class="header-logo-left">
          </td>
          <td class="header-cell-right">
            <img src="${acctLogo}" alt="ACCT Accredited Vendor" class="header-logo-right">
          </td>
        </tr>
      </table>
    </div>
  `;
}

/**
 * Creates the page footer with ONLY page number and disclaimer text
 * NO LOGOS IN FOOTER (per PDF export requirements)
 * 
 * @param pageNum - Current page number (no total count due to dynamic content)
 * @param disclaimerText - The disclaimer/footer text content
 */
export function createPageFooter(
  pageNum: number, 
  disclaimerText: string
): string {
  return `
    <div class="page-footer">
      <div class="footer-line"></div>
      <div class="footer-disclaimer">${disclaimerText}</div>
    </div>
  `;
}

/**
 * Format a timestamp for display in audit/attestation blocks (Central Time).
 */
function formatStamp(iso: string | null | undefined): string {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Escape HTML to prevent injection in user-provided strings.
 */
function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Summarize a user-agent string into a short device descriptor.
 */
function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const s = String(ua);
  let os = 'Unknown OS';
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/iPhone|iPad|iOS/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Linux/.test(s)) os = 'Linux';
  let browser = 'Unknown browser';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/Chrome\//.test(s) && !/Edg\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && !/Chrome\//.test(s)) browser = 'Safari';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  return `${browser} on ${os}`;
}

/**
 * Query audit_logs for any post-completion edits to a report.
 * Returns up to 5 most recent edits with editor name lookups.
 *
 * @param supabase - service-role client
 * @param tableName - 'inspections' | 'trainings' | 'daily_assessments'
 * @param recordId - report row id
 * @param completedAt - the timestamp the report was first completed (or attestation_signed_at)
 */
export async function fetchPostCompletionEdits(
  supabase: any,
  tableName: string,
  recordId: string,
  completedAt: string | null | undefined,
): Promise<Array<{ created_at: string; user_id: string | null; editor_name: string }>> {
  if (!completedAt) return [];
  try {
    const { data: rows, error } = await supabase
      .from('audit_logs')
      .select('created_at, user_id, action_type')
      .eq('table_name', tableName)
      .eq('record_id', recordId)
      .gt('created_at', completedAt)
      .in('action_type', [`${tableName.replace(/s$/, '')}.update`, `${tableName}.update`, 'update'])
      .order('created_at', { ascending: false })
      .limit(5);
    if (error || !rows || rows.length === 0) return [];

    const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)));
    let nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds);
      (profiles || []).forEach((p: any) => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
        nameMap[p.id] = name || 'Admin';
      });
    }
    return rows.map((r: any) => ({
      created_at: r.created_at,
      user_id: r.user_id,
      editor_name: r.user_id ? (nameMap[r.user_id] || 'Admin') : 'System',
    }));
  } catch (e) {
    console.error('[Report Layout] fetchPostCompletionEdits failed:', e);
    return [];
  }
}

/**
 * Build the amber "Edited after completion" banner shown at top of report.
 * Returns empty string if there are no post-completion edits.
 */
export function buildAdminEditBanner(
  _edits: Array<{ created_at: string; editor_name: string }>,
): string {
  // Banner intentionally disabled — audit trail is preserved in the admin panel only.
  // Function signature retained to avoid churn at the three edge function call sites.
  return '';
}

/**
 * Build the inspector e-signature / attestation block shown at end of report.
 * Returns empty string if no attestation has been captured.
 */
export function buildAttestationBlock(att: {
  attestation_signed_at?: string | null;
  attestation_signer_name?: string | null;
  attestation_ip?: string | null;
  attestation_user_agent?: string | null;
  attestation_text?: string | null;
} | null | undefined): string {
  if (!att || !att.attestation_signed_at || !att.attestation_signer_name) return '';
  const device = summarizeUserAgent(att.attestation_user_agent);
  const ipLine = att.attestation_ip ? ` &middot; IP: ${escapeHtml(att.attestation_ip)}` : '';
  return `
    <div class="attestation-block" style="
      margin: 24px 0 12px 0;
      padding: 14px 16px;
      border: 1px solid #1e40af;
      border-left: 4px solid #1e40af;
      background: #f8fafc;
      font-family: Arial, sans-serif;
      font-size: 9.5pt;
      line-height: 1.5;
      color: #0f172a;
      page-break-inside: avoid;
      border-radius: 3px;
    ">
      <div style="font-weight:bold; font-size:10pt; margin-bottom:6px; color:#1e40af; text-transform:uppercase; letter-spacing:0.5px;">
        Electronic Signature &amp; Attestation
      </div>
      <div style="margin-bottom:6px;">
        Electronically signed by <strong>${escapeHtml(att.attestation_signer_name)}</strong>
        on ${formatStamp(att.attestation_signed_at)}
      </div>
      <div style="font-size:8.5pt; color:#475569; margin-bottom:8px;">
        Device: ${escapeHtml(device)}${ipLine}
      </div>
      ${att.attestation_text ? `
        <div style="font-style:italic; padding:8px 10px; background:#fff; border-left:2px solid #cbd5e1; font-size:9pt; color:#334155;">
          "${escapeHtml(att.attestation_text)}"
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Build the version-stamp footer line shown at the very end of every report.
 * Format: "Generated by RW Reports v[app] · Report v[report] · [timestamp]"
 */
export function buildVersionFooter(opts: {
  appVersion?: string | null;
  reportVersion?: number | string | null;
  generatedAt?: string | null;
}): string {
  const app = opts.appVersion || 'unknown';
  const rv = opts.reportVersion != null ? `v${opts.reportVersion}` : 'v1';
  const gen = opts.generatedAt
    ? formatStamp(opts.generatedAt)
    : formatStamp(new Date().toISOString());
  return `
    <div class="version-stamp" style="
      margin: 16px 0 4px 0;
      text-align: center;
      font-family: Arial, sans-serif;
      font-size: 7.5pt;
      color: #94a3b8;
      letter-spacing: 0.3px;
    ">
      Generated by RW Reports v${escapeHtml(app)} &middot; Report ${escapeHtml(rv)} &middot; ${gen}
    </div>
  `;
}

/**
 * Shared CSS for header/footer layout
 * HEADER: Both logos on same horizontal line (Belay Reports LEFT, ACCT RIGHT)
 * FOOTER: NO logos - only page number, line, and disclaimer
 */
export const SHARED_HEADER_FOOTER_CSS = `
    /* 
     * SHARED HEADER/FOOTER LAYOUT
     * ============================
     * HEADER: Both logos on same line (LEFT: Belay Reports, RIGHT: ACCT)
     * FOOTER: NO logos - only page number and disclaimer text
     */
    :root {
      --report-logo-max-h: 35px;
      --pdf-header-h: 55px;
      --pdf-footer-h: 70px;
    }
    
    .page-header {
      padding: 8px 0;
      border-bottom: 2px solid #1e40af;
      margin-bottom: 12px;
      position: relative;
      width: 100%;
      min-height: 40px;
      max-height: 50px;
    }

    .header-logo-table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
    }

    .header-cell-left {
      text-align: left;
      vertical-align: middle;
      width: 50%;
    }

    .header-cell-right {
      text-align: right;
      vertical-align: middle;
      width: 50%;
    }

    .header-logo-left,
    .header-logo-right {
      height: auto !important;
      max-height: var(--report-logo-max-h) !important;
      width: auto !important;
      max-width: 100% !important;
      object-fit: contain !important;
      display: block;
    }
    
    .page-footer {
      margin-top: 12px;
      font-size: 9pt;
      color: #666;
      position: relative;
      padding-top: 8px;
    }

    .page-number {
      display: none;
    }

    .footer-line {
      border-top: 1px solid #000;
      margin-bottom: 6px;
    }

    .footer-disclaimer {
      text-align: center;
      line-height: 1.3;
      font-size: 8.5pt;
      margin: 0 auto;
    }
`;

/**
 * Print/PDF CSS for proper layout and logo visibility
 * CRITICAL: Ensures logos render in header only, never in footer
 * Prevents content clipping by reserving space for header/footer
 */
export const SHARED_PRINT_CSS = `
    /* 
     * PRINT/PDF LAYOUT FIX
     * ====================
     * 1. Header: Logos always visible, same line (LEFT/RIGHT)
     * 2. Footer: NO logos - disclaimer only
     * 3. Body content: Reserved padding to prevent clipping
     * 4. Proper pagination with page breaks
     */
    
    @page {
      size: Letter;
      margin: 0.5in 0.35in 0.6in 0.35in;
    }
    
    html, body {
      height: auto !important;
      overflow: visible !important;
    }
    
    /* Content area with reserved space for header/footer */
    .page, .pdf-content, .report-root {
      height: auto !important;
      min-height: auto !important;
      overflow: visible !important;
      padding-top: 5px;
      padding-bottom: 10px;
    }
    
    /* HEADER - always visible with both logos on same line */
    .page-header {
      display: block !important;
      visibility: visible !important;
      height: auto !important;
      max-height: 55px !important;
      margin-bottom: 8px !important;
      page-break-inside: avoid !important;
      page-break-after: avoid !important;
    }
    
    /* Table layout ensures logos stay on same row in PDF */
    .header-logo-table {
      width: 100% !important;
      table-layout: fixed !important;
      border-collapse: collapse !important;
    }
    
    .header-cell-left,
    .header-cell-right {
      display: table-cell !important;
      visibility: visible !important;
      vertical-align: middle !important;
    }
    
    .header-cell-left {
      text-align: left !important;
    }
    
    .header-cell-right {
      text-align: right !important;
    }
    
    /* LOGO VISIBILITY - Force header logos to render in PDF, hard capped at 35px */
    .header-logo-left,
    .header-logo-right {
      display: inline-block !important;
      visibility: visible !important;
      opacity: 1 !important;
      height: auto !important;
      max-height: 35px !important;
      width: auto !important;
      max-width: 100% !important;
      object-fit: contain !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    
    /* PHOTO VISIBILITY - Ensure photos render in PDF */
    .photo-gallery img,
    .inspection-photo {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      max-width: 100% !important;
      height: auto !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      page-break-inside: avoid !important;
    }
    
    /* FOOTER - visible, NO logos */
    .page-footer {
      display: block !important;
      visibility: visible !important;
      margin-top: 12px !important;
      padding-top: 8px !important;
      page-break-inside: avoid !important;
    }
    
    .page-number {
      display: none !important;
    }
    
    .footer-line {
      display: block !important;
      visibility: visible !important;
    }
    
    .footer-disclaimer {
      display: block !important;
      visibility: visible !important;
    }
    
    /* PAGE BREAK CONTROLS - prevent awkward splits */
    .section-title,
    .checklist-item,
    .row,
    .info-grid,
    .systems-grid,
    .info-table tr,
    h2, h3 {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    /* Allow sections to flow across pages */
    .section {
      page-break-inside: auto;
      break-inside: auto;
    }
`;
