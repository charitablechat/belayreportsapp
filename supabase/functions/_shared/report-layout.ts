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

// Fetch logos from Supabase storage and convert to base64 data URIs
export async function getLogoBase64(): Promise<{ropeWorks: string, acct: string}> {
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
      console.log('[Report Layout] Rope Works base64 length:', ropeWorksBase64.length);
      console.log('[Report Layout] ACCT base64 length:', acctBase64.length);
      
      return {
        ropeWorks: `data:${ropeWorksMime};base64,${ropeWorksBase64}`,
        acct: `data:${acctMime};base64,${acctBase64}`
      };
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
  return `
    <div class="page-header">
      <div class="header-left">
        <img src="${ropeWorksLogo}" alt="Rope Works" class="header-logo-left">
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor" class="header-logo-right">
      </div>
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
      <div class="page-number">Page ${pageNum}</div>
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
     * 
     * PDF LAYOUT VARIABLES:
     * --pdf-header-h: Reserved space for fixed header
     * --pdf-footer-h: Reserved space for fixed footer
     */
    :root {
      --pdf-header-h: 80px;
      --pdf-footer-h: 70px;
    }
    
    /* HEADER STYLES - Both logos on same line */
    .page-header {
      display: flex;
      flex-wrap: nowrap;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 3px solid #1e40af;
      margin-bottom: 15px;
      position: relative;
      width: 100%;
      min-height: 60px;
    }

    .header-left {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }

    .header-left img,
    .header-logo-left {
      height: 55px;
      max-height: 55px;
      max-width: 200px;
      width: auto;
      object-fit: contain;
    }

    .header-right {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }

    .header-right img,
    .header-logo-right {
      height: 50px;
      max-height: 50px;
      max-width: 180px;
      width: auto;
      object-fit: contain;
    }
    
    /* FOOTER STYLES - NO LOGOS, only disclaimer */
    .page-footer {
      margin-top: 20px;
      font-size: 9pt;
      color: #666;
      position: relative;
      padding-top: 10px;
    }

    .page-number {
      text-align: right;
      font-weight: normal;
      font-size: 9pt;
      color: #333;
      margin-bottom: 4px;
    }

    .footer-line {
      border-top: 1px solid #000;
      margin-bottom: 8px;
    }

    .footer-disclaimer {
      text-align: center;
      line-height: 1.5;
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
      margin: 0.5in 0.5in 0.7in 0.5in;
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
    
    /* HEADER - always visible with both logos */
    .page-header {
      display: flex !important;
      flex-wrap: nowrap !important;
      visibility: visible !important;
      height: auto !important;
      max-height: 70px !important;
      margin-bottom: 10px !important;
      page-break-inside: avoid !important;
      page-break-after: avoid !important;
    }
    
    .page-header .header-left,
    .page-header .header-right {
      display: flex !important;
      visibility: visible !important;
      flex: 0 0 auto !important;
    }
    
    /* LOGO VISIBILITY - Force header logos to render in PDF */
    .page-header .header-left img,
    .page-header .header-right img,
    .header-logo-left,
    .header-logo-right {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      max-height: 50px !important;
      max-width: 180px !important;
      height: auto !important;
      width: auto !important;
      object-fit: contain !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    
    /* FOOTER - visible, NO logos */
    .page-footer {
      display: block !important;
      visibility: visible !important;
      margin-top: 15px !important;
      padding-top: 10px !important;
      page-break-inside: avoid !important;
    }
    
    .page-number {
      display: block !important;
      visibility: visible !important;
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
