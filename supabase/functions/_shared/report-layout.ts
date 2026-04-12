/**
 * Shared Report Layout Components
 * ================================
 * This file provides consistent header/footer layouts across all report types.
 * 
 * LOGO PLACEMENT (PDF EXPORT REQUIREMENTS):
 * - HEADER: Both logos on same horizontal line (Rope Works LEFT, ACCT RIGHT)
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
let cachedLogos: { ropeWorks: string; acct: string } | null = null;

// Fetch logos from Supabase storage and convert to base64 data URIs
export async function getLogoBase64(): Promise<{ropeWorks: string, acct: string}> {
  if (cachedLogos) {
    console.log('[Report Layout] Using cached logos');
    return cachedLogos;
  }

  const storageBaseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co/storage/v1/object/public/pdf-templates';
  const ropeWorksUrl = `${storageBaseUrl}/rope-works-logo-embedded.png`;
  const acctUrl = `${storageBaseUrl}/acct-logo-embedded.png`;
  
  console.log('[Report Layout] Fetching logos from storage...');
  
  try {
    const [ropeWorksResponse, acctResponse] = await Promise.all([
      fetch(ropeWorksUrl),
      fetch(acctUrl)
    ]);
    
    if (ropeWorksResponse.ok && acctResponse.ok) {
      const [ropeWorksBuffer, acctBuffer] = await Promise.all([
        ropeWorksResponse.arrayBuffer(),
        acctResponse.arrayBuffer()
      ]);
      
      const ropeWorksBase64 = arrayBufferToBase64(ropeWorksBuffer);
      const acctBase64 = arrayBufferToBase64(acctBuffer);
      
      const ropeWorksMime = ropeWorksResponse.headers.get('content-type') || 'image/png';
      const acctMime = acctResponse.headers.get('content-type') || 'image/png';
      
      console.log('[Report Layout] Successfully loaded logos from storage');
      
      cachedLogos = {
        ropeWorks: `data:${ropeWorksMime};base64,${ropeWorksBase64}`,
        acct: `data:${acctMime};base64,${acctBase64}`
      };
      return cachedLogos;
    } else {
      console.error('[Report Layout] Failed to fetch logos:', ropeWorksResponse.status, acctResponse.status);
    }
  } catch (error) {
    console.error('[Report Layout] Error fetching logos:', error);
  }
  
  console.warn('[Report Layout] Using placeholder logos');
  return { ropeWorks: PLACEHOLDER_LOGO, acct: PLACEHOLDER_LOGO };
}

/**
 * Creates the page header with both logos on same line
 * - Rope Works logo: LEFT aligned
 * - ACCT logo: RIGHT aligned
 * - Both on same horizontal line (flexbox nowrap)
 */
export function createPageHeader(ropeWorksLogo: string, acctLogo: string): string {
  // Use table layout for PDF reliability - tables never wrap cells to new rows
  return `
    <div class="page-header">
      <table class="header-logo-table" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="header-cell-left">
            <img src="${ropeWorksLogo}" alt="Rope Works" class="header-logo-left">
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
 * Shared CSS for header/footer layout
 * HEADER: Both logos on same horizontal line (Rope Works LEFT, ACCT RIGHT)
 * FOOTER: NO logos - only page number, line, and disclaimer
 */
export const SHARED_HEADER_FOOTER_CSS = `
    /* 
     * SHARED HEADER/FOOTER LAYOUT
     * ============================
     * HEADER: Both logos on same line (LEFT: Rope Works, RIGHT: ACCT)
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
