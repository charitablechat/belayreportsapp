import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { 
  getLogoBase64, 
  createPageHeader, 
  createPageFooter,
  SHARED_HEADER_FOOTER_CSS,
  SHARED_PRINT_CSS 
} from "../_shared/report-layout.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { assessmentId } = await req.json();
    
    // Fetch logos from storage using shared helper
    const logos = await getLogoBase64();
    const ropeWorksLogo = logos.ropeWorks;
    const acctLogo = logos.acct;

    // Fetch assessment data
    const { data: assessment } = await supabase
      .from('daily_assessments')
      .select('*')
      .eq('id', assessmentId)
      .single();

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
    const formatDate = (dateStr: string) => {
      if (!dateStr) return 'N/A';
      const date = new Date(dateStr);
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

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Course Assessment - ${assessment.site}</title>
  <style>
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
      --page-padding: 0.25in;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
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
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
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
      margin-top: 20px;
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

    .page-title {
      color: #1e40af;
      font-size: 24px;
      margin-bottom: 8px;
      font-weight: 700;
    }

    .page-subtitle {
      color: #64748b;
      font-size: 14px;
      margin-bottom: 20px;
    }

    .section {
      margin-bottom: 20px;
    }

    .section-title {
      background: #1e40af;
      color: white;
      padding: 10px 15px;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      border-radius: 4px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 15px;
    }

    .info-item {
      padding: 10px;
      background: #f8fafc;
      border-left: 3px solid #1e40af;
    }

    .info-item.full-width {
      grid-column: span 2;
    }

    .info-label {
      font-weight: 600;
      color: #475569;
      font-size: 12px;
      margin-bottom: 4px;
    }

    .info-value {
      color: #1e293b;
      font-size: 13px;
    }

    ul {
      list-style: none;
      padding-left: 0;
    }

    li {
      display: flex;
      gap: 10px;
      padding: 8px 10px;
      margin-bottom: 6px;
      background: #f8fafc;
      border-left: 3px solid #3b82f6;
      border-radius: 2px;
      align-items: flex-start;
    }

    li.checked {
      border-left-color: #22c55e;
    }

    li.unchecked {
      border-left-color: #ef4444;
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
      color: #1e293b;
      font-size: 13px;
    }

    .item-comments {
      font-size: 12px;
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
      padding: 8px 10px;
      background: #f8fafc;
      border-left: 3px solid #22c55e;
      border-radius: 2px;
      font-size: 13px;
    }

    .system-item .checkbox-icon {
      color: #22c55e;
      font-size: 16px;
    }

    .disclaimer {
      background: #fef3c7;
      padding: 12px;
      border-radius: 4px;
      border-left: 4px solid #f59e0b;
      margin-top: 20px;
    }

    .disclaimer-title {
      font-weight: 700;
      color: #92400e;
      margin-bottom: 6px;
      font-size: 13px;
    }

    .disclaimer-text {
      color: #78350f;
      font-size: 12px;
      line-height: 1.5;
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
        margin: 0.5in 0.5in 0.7in 0.5in;
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
        margin: 0 0 10px 0 !important;
        box-shadow: none !important;
        page-break-after: always !important;
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
  </style>
</head>
<body>
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
          <div class="info-item full-width">
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
      </div>
      ` : ''}

      ${renderChecklistItems(beginningOfDay, 'Beginning of Day Checklist')}
    </div>
    ${footer(1)}
  </div>

  <!-- Page 2: End of Day Checklist -->
  <div class="page">
    ${header()}
    <div class="page-content">
      ${renderChecklistItems(endOfDay, 'End of Day Checklist')}
    </div>
    ${footer(2)}
  </div>

  <!-- Page 3: Equipment + Structure Inspections -->
  <div class="page">
    ${header()}
    <div class="page-content">
      ${renderChecklistItems(equipmentChecks, 'Equipment Inspection')}
      ${renderChecklistItems(structureChecks, 'Structure Inspection')}
    </div>
    ${footer(3)}
  </div>

  <!-- Page 4: Environment + Disclaimer -->
  <div class="page">
    ${header()}
    <div class="page-content">
      ${renderChecklistItems(environmentChecks, 'Environment Inspection')}

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
    ${footer(4)}
  </div>
</body>
</html>
    `;

    return new Response(
      JSON.stringify({ html }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
        status: 200,
      }
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
