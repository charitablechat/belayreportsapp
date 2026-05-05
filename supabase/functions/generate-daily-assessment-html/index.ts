import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { 
  getLogoBase64, 
  createPageHeader, 
  createPageFooter,
  SHARED_HEADER_FOOTER_CSS,
  SHARED_PRINT_CSS,
  buildAdminEditBanner,
  buildAttestationBlock,
  buildVersionFooter,
  fetchPostCompletionEdits,
} from "../_shared/report-layout.ts";

// Deduplicate checklist items by item_key (keeps first occurrence)
function deduplicateChecklistItems<T extends { item_key?: string; system_name?: string }>(items: T[] | null, keyField: 'item_key' | 'system_name' = 'item_key'): T[] {
  if (!items || items.length === 0) return [];
  
  const seen = new Set<string>();
  const deduplicated: T[] = [];
  let duplicateCount = 0;
  
  for (const item of items) {
    const key = item[keyField];
    if (key && !seen.has(key)) {
      seen.add(key);
      deduplicated.push(item);
    } else if (key) {
      duplicateCount++;
    }
  }
  
  if (duplicateCount > 0) {
    console.warn(`Removed ${duplicateCount} duplicate items by ${keyField}`);
  }
  
  return deduplicated;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { assessmentId, forceRegenerate } = await req.json();

    // OPTIMIZATION: Parallelize logo fetch with assessment data fetch
    const [logos, assessmentResult] = await Promise.all([
      getLogoBase64(),
      supabase.from('daily_assessments').select('*').eq('id', assessmentId).single(),
    ]);
    const ropeWorksLogo = logos.ropeWorks;
    const acctLogo = logos.acct;
    const { data: assessment } = assessmentResult;

    // OPTIMIZATION: Server-side cache check — skip regeneration if nothing changed
    if (!forceRegenerate && assessment?.latest_report_generated_at && assessment?.updated_at) {
      const generatedAt = new Date(assessment.latest_report_generated_at).getTime();
      const updatedAt = new Date(assessment.updated_at).getTime();
      
      if (generatedAt >= updatedAt && assessment.latest_report_html) {
        console.log(`[generate-daily-assessment-html] Cache HIT — returning cached report.`);
        return new Response(
          JSON.stringify({ html: assessment.latest_report_html, cached: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }, status: 200 }
        );
      }
      console.log(`[generate-daily-assessment-html] Cache MISS — report data changed.`);
    }

    const [bodData, eodData, osData, eqData, stData, envData] = await Promise.all([
      supabase.from('daily_assessment_beginning_of_day').select('*').eq('assessment_id', assessmentId),
      supabase.from('daily_assessment_end_of_day').select('*').eq('assessment_id', assessmentId),
      supabase.from('daily_assessment_operating_systems').select('*').eq('assessment_id', assessmentId),
      supabase.from('daily_assessment_equipment_checks').select('*').eq('assessment_id', assessmentId),
      supabase.from('daily_assessment_structure_checks').select('*').eq('assessment_id', assessmentId),
      supabase.from('daily_assessment_environment_checks').select('*').eq('assessment_id', assessmentId),
    ]);

    // Log raw data counts before deduplication
    console.log(`[Report] Raw data fetched from database:
  - Beginning of Day: ${bodData.data?.length ?? 0}
  - End of Day: ${eodData.data?.length ?? 0}
  - Operating Systems: ${osData.data?.length ?? 0}
  - Equipment Checks: ${eqData.data?.length ?? 0}
  - Structure Checks: ${stData.data?.length ?? 0}
  - Environment Checks: ${envData.data?.length ?? 0}
`);

    // Deduplicate all checklist data to prevent duplicate entries in reports
    const beginningOfDay = deduplicateChecklistItems(bodData.data, 'item_key');
    const endOfDay = deduplicateChecklistItems(eodData.data, 'item_key');
    const operatingSystems = deduplicateChecklistItems(osData.data, 'system_name');
    const equipmentChecks = deduplicateChecklistItems(eqData.data, 'item_key');
    const structureChecks = deduplicateChecklistItems(stData.data, 'item_key');
    const environmentChecks = deduplicateChecklistItems(envData.data, 'item_key');

    // Log counts after deduplication
    console.log(`[Report] After deduplication:
  - Beginning of Day: ${beginningOfDay.length} (checked: ${beginningOfDay.filter(i => i.is_complete).length})
  - End of Day: ${endOfDay.length} (checked: ${endOfDay.filter(i => i.is_complete).length})
  - Operating Systems: ${operatingSystems.length}
  - Equipment Checks: ${equipmentChecks.length} (checked: ${equipmentChecks.filter(i => i.is_checked).length})
  - Structure Checks: ${structureChecks.length} (checked: ${structureChecks.filter(i => i.is_checked).length})
  - Environment Checks: ${environmentChecks.length} (checked: ${environmentChecks.filter(i => i.is_checked).length})
`);

    // Format dates in Central Time (CST/CDT)
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return 'N/A';
      const SPECIAL_DATE_VALUES = ["N/A", "Unknown"];
      if (SPECIAL_DATE_VALUES.includes(dateStr)) return dateStr;

      // Parse date-only strings (YYYY-MM-DD) as local to avoid UTC shift
      const dateOnly = dateStr.split('T')[0];
      const parts = dateOnly.split('-');
      if (parts.length === 3) {
        const [year, month, day] = parts.map(Number);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
          const months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ];
          return `${months[month - 1]} ${day}, ${year}`;
        }
      }

      // Fallback for datetime strings or unparseable values
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric' });
    };

    const generatedTimestamp = new Date().toLocaleString('en-US', { 
      timeZone: 'America/Chicago', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const renderChecklistItems = (items: any[] | null, title: string) => {
      if (!items || items.length === 0) return '';
      return `
        <div class="section">
          <div class="section-title">${title}</div>
          <ul>
            ${items.map(item => `
              <li class="${item.is_complete || item.is_checked ? 'checked' : 'unchecked'}">
                <span class="checkbox-icon">${item.is_complete || item.is_checked ? '☑' : '☐'}</span>
                <div class="item-content">
                  <span class="item-label">${item.item_key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</span>
                  ${item.comments ? `<div class="item-comments">${item.comments}</div>` : ''}
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    };

    // Footer disclaimer text for daily assessment
    const footerDisclaimerText = `Daily Course Assessment Documentation | ${assessment.site || 'N/A'}<br>Generated on ${generatedTimestamp}`;

    // Helper wrappers using shared layout functions
    // HEADER: Both logos (Rope Works LEFT, ACCT RIGHT on same line)
    // FOOTER: NO logos - only page number and disclaimer text
    const header = () => createPageHeader(ropeWorksLogo, acctLogo);
    const footer = (pageNum: number) => createPageFooter(pageNum, footerDisclaimerText);

    // Admin-edit banner intentionally disabled — audit trail lives in the admin panel only.
    const adminEditBannerHtml = '';

    // Terminal-style section comments renderer
    const renderSectionComments = (comments: string | null, title: string) => {
      if (!comments || comments.trim() === '') return '';
      return `
        <div class="section-notes">
          <div class="notes-header">
            <span class="notes-icon">▶</span>
            <span class="notes-title">${title}</span>
          </div>
          <pre class="notes-content">${comments.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
      `;
    };

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${(assessment.organization || 'Daily Assessment').replace(/\s+/g, '_')}</title>
  <style>
     /* Clean professional document style */
    
    /* 
     * FIX: Content Clipping Prevention
     * --------------------------------
     * PROBLEM: Content was running underneath the footer because pages had:
     *   - overflow: hidden (clips content)
     *   - max-height constraints (limits page height)
     * SOLUTION: Remove these constraints and let content flow naturally.
     * The browser/PDF engine will paginate correctly with proper @page margins.
     *
     * LOGO FIX: ACCT logo uses same inline base64 as Inspection Report.
     * We add explicit visibility rules to ensure logos always render in print.
     */
    
    :root {
      --pdf-header-h: 85px;
      --pdf-footer-h: 80px;
      --page-padding: 0.2in;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #000;
      background: #ffffff;
      padding: 10px;
    }

    /* 
     * Page structure - NO FIXED HEIGHTS, NO OVERFLOW HIDDEN
     * Content flows naturally and browser handles pagination
     */
    .page {
      display: block;
      padding: var(--page-padding);
      background: white;
      margin-bottom: 20px;
      box-shadow: none;
      page-break-after: always;
      /* CRITICAL: No max-height, no overflow:hidden */
    }

    .page-content {
      /* Content flows naturally - no clipping */
    }

    .page:last-child {
      page-break-after: avoid;
    }

    /* Header styling - logos must be visible */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      border-bottom: 3px solid #1e40af;
      margin-bottom: 15px;
      position: relative;
    }

    .header-left {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }

    .header-logo-left {
      height: 35px !important;
      max-height: 35px !important;
      width: auto;
      object-fit: contain;
    }

    .header-right {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }

    .header-logo-right {
      height: 35px !important;
      max-height: 35px !important;
      width: auto;
      object-fit: contain;
    }

    .page-footer {
      margin-top: 12px;
      font-size: 9pt;
      color: #666;
      position: relative;
    }
    
    /* Footer logo row - same line, left/right alignment */
    .footer-logo-row {
      display: flex;
      flex-wrap: nowrap;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      margin-bottom: 8px;
    }
    
    .footer-logo-left,
    .footer-logo-right {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }
    
    .footer-logo {
      height: 35px;
      max-height: 35px;
      max-width: 140px;
      width: auto;
      object-fit: contain;
    }

    .page-number {
      display: none;
    }

    .footer-line {
      border-top: 1px solid #000;
      margin-bottom: 8px;
    }

    .footer-disclaimer {
      text-align: center;
      line-height: 1.3;
      font-size: 8.5pt;
      margin: 0 auto;
    }

    .page-title {
      color: #1e40af;
      font-size: 24pt;
      margin-bottom: 8px;
      font-weight: bold;
    }

    .page-subtitle {
      color: #64748b;
      font-size: 14px;
      margin-bottom: 20px;
    }

    .section {
      margin-bottom: 14px;
    }

    .section-title {
      background: #1B6DB5;
      color: white;
      padding: 6px 10px;
      font-size: 16pt;
      font-weight: bold;
      margin: 12px 0 8px 0;
      line-height: 1.4;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px 20px;
      margin: 14px 0;
      border: none;
    }

    .info-item {
      padding: 0;
      background: transparent;
      border: none;
      border-radius: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .info-item.full-width {
      grid-column: span 2;
    }

    .info-label {
      font-weight: 600;
      color: #000;
      font-size: 10pt;
      white-space: normal;
      flex-shrink: 0;
    }

    .info-value {
      flex: 1;
      color: #000;
      font-size: 10pt;
      line-height: 1.4;
      border-bottom: 1px dotted #666;
      min-height: 18px;
      padding-bottom: 2px;
    }

    ul {
      list-style: none;
      padding-left: 0;
    }

    li {
      display: flex;
      gap: 10px;
      padding: 6px 0;
      margin-bottom: 4px;
      background: transparent;
      border: none;
      border-bottom: 1px dotted #ccc;
      align-items: flex-start;
    }

    li:last-child {
      border-bottom: none;
    }

    li.checked {
      /* Clean style - no colored left border */
    }

    li.unchecked {
      /* Clean style - no colored left border */
    }

    .checkbox-icon {
      font-size: 16px;
      font-weight: bold;
      flex-shrink: 0;
      width: 20px;
      text-align: center;
    }

    li.checked .checkbox-icon {
      color: #22c55e;
    }

    li.unchecked .checkbox-icon {
      color: #ef4444;
    }

    .item-content {
      flex: 1;
    }

    .item-label {
      font-weight: 500;
      color: #000;
      font-size: 10pt;
    }

    em {
      font-style: italic;
      font-weight: 500;
      color: rgba(0, 0, 0, 0.9);
      letter-spacing: 0.01em;
    }

    .item-comments {
      font-size: 9pt;
      color: #64748b;
      font-style: italic;
      margin-top: 3px;
    }

    .systems-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .system-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      background: transparent;
      border: none;
      border-bottom: 1px dotted #ccc;
      border-radius: 0;
      font-size: 10pt;
    }

    .system-item .checkbox-icon {
      color: #22c55e;
      font-size: 16px;
    }

    .disclaimer {
      background: transparent;
      padding: 10px 0;
      border-radius: 0;
      border-left: none;
      margin-top: 14px;
    }

    .disclaimer-title {
      font-weight: 700;
      color: #000;
      margin-bottom: 6px;
      font-size: 10pt;
    }

    .disclaimer-text {
      color: #666;
      font-size: 8.5pt;
      line-height: 1.5;
      font-style: italic;
    }

    /* Section notes - clean style */
    .section-notes {
      background: transparent;
      border-radius: 0;
      padding: 12px;
      margin-top: 16px;
      border: 1px solid #000;
      font-family: Georgia, 'Times New Roman', serif;
    }

    .notes-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .notes-icon {
      color: #333;
      font-size: 12px;
    }

    .notes-title {
      color: #000;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }

    .notes-content {
      color: #000000;
      font-size: 12px;
      line-height: 1.6;
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
      padding: 8px;
      background: transparent;
      border-radius: 0;
      border-left: none;
    }

    /* 
     * PRINT STYLES - Content Flow Fix
     * --------------------------------
     * CRITICAL: height: auto and overflow: visible allow content to flow
     * across multiple pages without clipping. The @page margins reserve
     * space so content doesn't run under fixed headers/footers.
     */
    @media print {
      html, body {
        height: auto !important;
        overflow: visible !important;
        background: white !important;
        padding: 0 !important;
        margin: 0 !important;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
        font-size: 10pt;
        line-height: 1.4;
      }

      /* Reserve space for content - prevents footer overlap */
      @page {
        size: letter portrait;
        margin: 0.3in 0.3in 0.45in 0.3in;
      }

      .page {
        display: block !important;
        position: relative !important;
        /* CRITICAL FIX: Allow content to flow naturally */
        height: auto !important;
        min-height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        padding: 0 !important;
        margin: 0 0 4px 0 !important;
        box-shadow: none !important;
        page-break-after: auto !important;
        page-break-inside: auto !important;
      }

      .page:last-child {
        page-break-after: avoid !important;
        margin-bottom: 0 !important;
      }

      /* 
       * LOGO VISIBILITY FIX
       * Ensure both logos are ALWAYS visible in print/PDF
       * Never hidden by any print CSS rules
       */
      .page-header {
        display: flex !important;
        visibility: visible !important;
        height: auto !important;
        max-height: 70px !important;
        margin-bottom: 10px !important;
        position: relative !important;
        page-break-inside: avoid !important;
        page-break-after: avoid !important;
      }
      
      .page-header .header-left,
      .page-header .header-right {
        display: flex !important;
        visibility: visible !important;
        flex: 0 0 auto !important;
      }
      
      /* LOGO FIX: Force visibility - logos must render in PDF, capped at 35px */
      .header-logo-left,
      .header-logo-right {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: 35px !important;
        max-height: 35px !important;
        max-width: 180px !important;
        width: auto !important;
        object-fit: contain !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .page-content {
        display: block !important;
        height: auto !important;
        overflow: visible !important;
      }

      .page-footer {
        display: block !important;
        margin-top: 15px !important;
        padding-top: 10px !important;
        page-break-inside: avoid !important;
      }
      
      /* Footer logo visibility in print */
      .footer-logo-row {
        display: flex !important;
        flex-wrap: nowrap !important;
        visibility: visible !important;
      }
      
      .footer-logo-left,
      .footer-logo-right {
        display: flex !important;
        visibility: visible !important;
      }
      
      .footer-logo {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        max-height: 30px !important;
        max-width: 120px !important;
        height: auto !important;
        width: auto !important;
        object-fit: contain !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      /* Prevent awkward page breaks within items */
      .section {
        page-break-inside: avoid;
        page-break-after: auto;
      }

      .section-title {
        page-break-after: avoid;
        page-break-inside: avoid;
      }

      .info-grid, .systems-grid {
        page-break-inside: avoid;
      }

      li {
        page-break-inside: avoid;
      }

      .disclaimer {
        page-break-inside: avoid;
      }

      /* Color enforcement for PDF */
      *, *::before, *::after {
        print-color-adjust: exact !important;
        -webkit-print-color-adjust: exact !important;
      }

      * {
        box-shadow: none !important;
        text-shadow: none !important;
        animation: none !important;
        transition: none !important;
      }
    }

    @media (max-width: 768px) {
      html, body {
        max-width: 100vw;
        overflow-x: hidden;
      }
      
      body { padding: 8px; }
      
      .page {
        padding: 12px;
      }
      
      .page-header {
        flex-direction: row;
        gap: 10px;
      }
      
      .header-logo-left { height: 35px !important; max-height: 35px !important; }
      .header-logo-right { height: 35px !important; max-height: 35px !important; }
      
      .page-title { font-size: 18px; }
      
      .info-grid {
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .info-item.full-width {
        grid-column: span 1;
      }
      
      .section-title {
        font-size: 13px;
        padding: 8px 12px;
      }

      .systems-grid {
        grid-template-columns: 1fr;
      }
      
      li {
        padding: 8px 10px;
        font-size: 12px;
      }
      
      .item-label, .item-comments, .notes-content {
        word-break: break-word;
        overflow-wrap: break-word;
      }
      
      .disclaimer {
        padding: 10px;
      }
    }

    @media (max-width: 480px) {
      body { padding: 4px; }
      .page { padding: 8px; }
      .page-title { font-size: 16px; }
      .section-title { font-size: 12px; }
    }

    /* Enhanced mobile viewport (< 600px) - Prevent overlap/clipping */
    @media screen and (max-width: 600px) {
      /* Header: Stack to prevent overlap */
      .page-header {
        flex-direction: column !important;
        align-items: center !important;
        gap: 8px !important;
        padding-bottom: 10px !important;
      }
      
      .header-left, .header-right {
        position: static !important;
        text-align: center !important;
        width: 100% !important;
      }
      
      /* Info grid: Single column, clear separation */
      .info-item {
        display: block !important;
        margin-bottom: 12px !important;
        border-bottom: 1px solid #e5e7eb !important;
        padding-bottom: 8px !important;
      }
      
      .info-label {
        display: block !important;
        white-space: normal !important;
        margin-bottom: 4px !important;
      }
      
      .info-value {
        display: block !important;
        word-break: break-word !important;
      }
      
      /* Checklist items: Readable sizing */
      li {
        word-break: break-word !important;
        font-size: 9pt !important;
        line-height: 1.4 !important;
      }
      
      /* Systems grid: Single column */
      .systems-grid {
        grid-template-columns: 1fr !important;
      }
      
      /* Section notes: Allow wrapping */
      .notes-content {
        word-break: break-word !important;
        font-size: 10pt !important;
      }
      
      /* Footer: Full width */
      .footer-disclaimer {
        max-width: 100% !important;
        padding: 0 4px !important;
        text-align: center !important;
      }
    }
  </style>
</head>
<body>
  ${adminEditBannerHtml}
  <!-- Page 1: Assessment Info + Operating Systems -->
  <div class="page">
    ${header()}
    <div class="page-content">
      <h1 class="page-title">Daily Course Assessment</h1>
      <p class="page-subtitle">Challenge Course Operations Documentation</p>

      <div class="section">
        <div class="section-title">Assessment Information</div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Date</div>
            <div class="info-value">${formatDate(assessment.assessment_date)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Site</div>
            <div class="info-value">${assessment.site || 'N/A'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Organization</div>
            <div class="info-value">${assessment.organization || 'N/A'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Trainer/Facilitator of Record</div>
            <div class="info-value">${assessment.trainer_of_record || 'N/A'}</div>
          </div>
        </div>
      </div>

      ${operatingSystems.length > 0 ? `
      <div class="section">
        <div class="section-title">Operating Systems in Use Today</div>
        <div class="systems-grid">
          ${operatingSystems.map(s => `
            <div class="system-item">
              <span class="checkbox-icon">☑</span>
              <span>${s.system_name}${s.other_description ? ` - ${s.other_description}` : ''}</span>
            </div>
          `).join('')}
        </div>
        ${renderSectionComments(assessment.systems_comments, 'Systems Notes')}
      </div>
      ` : ''}

      ${renderChecklistItems(beginningOfDay, 'Beginning of Day Checklist')}
    </div>
    ${footer(1)}
  </div>

  ${(() => {
    // Collect optional pages - only include pages that have content
    const optionalPages: { content: string }[] = [];

    // End of Day page
    const endOfDayContent = renderChecklistItems(endOfDay, 'End of Day Checklist');
    if (endOfDayContent) {
      optionalPages.push({ content: endOfDayContent });
    }

    // Equipment + Structure page
    const equipContent = renderChecklistItems(equipmentChecks, 'Equipment Inspection');
    const structContent = renderChecklistItems(structureChecks, 'Structure Inspection');
    const structNotes = renderSectionComments(assessment.structure_comments, 'Structure Notes');
    const page3Content = equipContent + structContent + structNotes;
    if (page3Content.trim()) {
      optionalPages.push({ content: page3Content });
    }

    // Environment page
    const envContent = renderChecklistItems(environmentChecks, 'Environment Inspection');
    const envNotes = renderSectionComments(assessment.environment_comments, 'Environment Notes');
    const page4Content = envContent + envNotes;
    if (page4Content.trim()) {
      optionalPages.push({ content: page4Content });
    }

    // Render optional pages with sequential numbering starting from page 2
    let pagesHtml = '';
    optionalPages.forEach((p, i) => {
      const pageNum = i + 2; // page 1 is always the first page
      const isLast = i === optionalPages.length - 1;
      pagesHtml += `
        <div class="page">
          ${header()}
          <div class="page-content">
            ${p.content}
            ${isLast ? `
              <div class="disclaimer">
                <div class="disclaimer-title">DISCLAIMER</div>
                <div class="disclaimer-text">
                  This daily assessment form documents the operational readiness checks performed for the challenge course facility. 
                  It is intended to verify that all safety systems, equipment, and environmental conditions meet operational standards 
                  before and after use. This document should be retained as part of the facility's operational records. Any items 
                  marked as incomplete or requiring attention should be addressed before course operations begin or resume.
                </div>
              </div>
            ` : ''}
          </div>
          ${footer(pageNum)}
        </div>
      `;
    });

    // If no optional pages, add a disclaimer-only page
    if (optionalPages.length === 0) {
      pagesHtml = `
        <div class="page">
          ${header()}
          <div class="page-content">
            <div class="disclaimer">
              <div class="disclaimer-title">DISCLAIMER</div>
              <div class="disclaimer-text">
                This daily assessment form documents the operational readiness checks performed for the challenge course facility. 
                It is intended to verify that all safety systems, equipment, and environmental conditions meet operational standards 
                before and after use. This document should be retained as part of the facility's operational records. Any items 
                marked as incomplete or requiring attention should be addressed before course operations begin or resume.
              </div>
            </div>
          </div>
          ${footer(2)}
        </div>
      `;
    }

    return pagesHtml;
  })()}
  ${buildAttestationBlock({
    attestation_signed_at: (assessment as any).attestation_signed_at,
    attestation_signer_name: (assessment as any).attestation_signer_name,
    attestation_ip: (assessment as any).attestation_ip,
    attestation_user_agent: (assessment as any).attestation_user_agent,
    attestation_text: (assessment as any).attestation_text,
  })}
  ${buildVersionFooter({
    appVersion: (assessment as any).app_version_at_completion,
    reportVersion: (assessment as any).report_version,
    generatedAt: new Date().toISOString(),
  })}
</body>
</html>
    `;

    // OPTIMIZATION: Return HTML directly for reports under 1MB
    const htmlSizeBytes = new TextEncoder().encode(html).length;
    const ONE_MB = 1024 * 1024;
    
    if (htmlSizeBytes < ONE_MB) {
      console.log(`[generate-daily-assessment-html] Report size ${(htmlSizeBytes / 1024).toFixed(1)}KB < 1MB — returning directly.`);
      return new Response(
        JSON.stringify({ html }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }, status: 200 }
      );
    }

    // Large reports: upload to storage
    console.log(`[generate-daily-assessment-html] Report size ${(htmlSizeBytes / 1024).toFixed(1)}KB >= 1MB — uploading to storage...`);
    
    const uploadTimestamp = Date.now();
    const filePath = `html-reports/daily-assessment-${assessmentId}-${uploadTimestamp}.html`;
    const htmlBlob = new Blob([html], { type: 'text/html' });
    
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(filePath, htmlBlob, {
        contentType: 'text/html',
        upsert: false,
      });

    if (uploadError) {
      console.error(`[generate-daily-assessment-html] Storage upload failed, returning directly:`, uploadError);
      return new Response(
        JSON.stringify({ html }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }, status: 200 }
      );
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('inspection-reports')
      .createSignedUrl(filePath, 86400);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error(`[generate-daily-assessment-html] Signed URL failed, returning directly:`, signedUrlError);
      return new Response(
        JSON.stringify({ html }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }, status: 200 }
      );
    }

    console.log(`[generate-daily-assessment-html] Complete. Returning signed URL.`);
    return new Response(
      JSON.stringify({ htmlUrl: signedUrlData.signedUrl, html }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }, status: 200 }
    );
  } catch (error) {
    console.error('Error generating HTML:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        status: 500,
      }
    );
  }
});
