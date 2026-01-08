import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Placeholder logos (1x1 transparent PNG)
const PLACEHOLDER_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Convert array buffer to base64 in chunks to avoid stack overflow
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function getLogoBase64(supabaseUrl: string): Promise<{ropeWorks: string, acct: string}> {
  const storageBaseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co/storage/v1/object/public/pdf-templates';
  const ropeWorksUrl = `${storageBaseUrl}/rope-works-logo-embedded.png`;
  const acctUrl = `${storageBaseUrl}/acct-logo-embedded.png`;
  
  console.log('Fetching logos from storage...');
  
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
      
      console.log('Successfully loaded logos from storage');
      console.log('Rope Works base64 length:', ropeWorksBase64.length);
      console.log('ACCT base64 length:', acctBase64.length);
      
      return {
        ropeWorks: `data:${ropeWorksMime};base64,${ropeWorksBase64}`,
        acct: `data:${acctMime};base64,${acctBase64}`
      };
    } else {
      console.error('Failed to fetch logos:', ropeWorksResponse.status, acctResponse.status);
    }
  } catch (error) {
    console.error('Error fetching logos:', error);
  }
  
  console.warn('Using placeholder logos');
  return { ropeWorks: PLACEHOLDER_LOGO, acct: PLACEHOLDER_LOGO };
}

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
    
    // Fetch logos from storage
    const logos = await getLogoBase64(supabaseUrl);
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

    // Helper functions for page structure (matching inspection/training reports)
    const createPageHeader = () => `
      <div class="page-header">
        <div class="header-left">
          <img src="${ropeWorksLogo}" alt="Rope Works">
        </div>
        <div class="header-right">
          <img src="${acctLogo}" alt="ACCT Accredited Vendor">
        </div>
      </div>
    `;

    const createPageFooter = (pageNum: number) => `
      <div class="page-footer">
        <div class="page-number">Page ${pageNum}</div>
        <div class="footer-line"></div>
        <div class="disclaimer-footer">
          Daily Course Assessment Documentation | ${assessment.site || 'N/A'}<br>
          Generated on ${generatedTimestamp}
        </div>
      </div>
    `;

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
     * Previous issue: overflow:hidden and max-height caused content to be clipped.
     * Solution: Use CSS variables for header/footer heights, allow content to flow
     * naturally across pages, and use page-break rules instead of fixed heights.
     */
    
    :root {
      --pdf-header-h: 85px;   /* Header height including border */
      --pdf-footer-h: 80px;   /* Footer height including padding */
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

    /* Page structure - allow natural content flow */
    .page {
      display: block;
      padding: var(--page-padding);
      background: white;
      margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      page-break-after: always;
      page-break-inside: auto;
      min-height: auto;
      /* No max-height or overflow:hidden - content must flow naturally */
    }

    .page-content {
      min-height: 200px;
      /* Content flows naturally, no clipping */
    }

    .page:last-child {
      page-break-after: avoid;
    }

    /* In-page header/footer for screen display */
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

    .header-left img {
      height: 55px;
      width: auto;
      object-fit: contain;
    }

    .header-right {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }

    .header-right img {
      height: 50px;
      width: auto;
      object-fit: contain;
    }

    .page-footer {
      margin-top: 20px;
      font-size: 9pt;
      color: #666;
      position: relative;
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

    .disclaimer-footer {
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
     * Print styles - Content Flow Fix
     * --------------------------------
     * FIX: Removed fixed heights and overflow:hidden that caused clipping.
     * Content now flows naturally across pages. Browser handles pagination.
     */
    @media print {
      html, body {
        height: auto !important;
        overflow: visible !important;
        background: white;
        padding: 0;
        margin: 0;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
        font-size: 10pt;
        line-height: 1.4;
      }

      @page {
        size: letter portrait;
        margin: 0.5in 0.5in 0.6in 0.5in; /* Extra bottom margin for footer */
      }

      .page {
        display: block !important;
        position: relative !important;
        /* Allow content to flow - no fixed height, no hidden overflow */
        height: auto !important;
        min-height: auto !important;
        max-height: none !important;
        padding: 0 !important;
        margin: 0 0 20px 0 !important;
        box-sizing: border-box !important;
        page-break-after: always !important;
        page-break-inside: auto !important; /* Allow breaks within page */
        box-shadow: none !important;
        overflow: visible !important; /* CRITICAL: Allow content to flow */
      }

      .page:last-child {
        page-break-after: avoid !important;
        margin-bottom: 0 !important;
      }

      .page > .page-header {
        display: flex !important;
        height: 60px !important;
        max-height: 60px !important;
        margin-bottom: 10px !important;
        position: relative !important;
        /* Header stays together */
        page-break-inside: avoid !important;
        page-break-after: avoid !important;
      }
      
      .page > .page-header img {
        max-height: 50px !important;
        width: auto !important;
        object-fit: contain !important;
      }

      .page > .page-footer {
        display: block !important;
        margin-top: 15px !important;
        padding-top: 10px !important;
        /* Footer stays together */
        page-break-inside: avoid !important;
        page-break-before: auto !important;
      }

      .page-content {
        display: block !important;
        height: auto !important;
        overflow: visible !important; /* CRITICAL: No clipping */
      }

      /* Keep sections together but allow page breaks between them */
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

      /* Color enforcement */
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
      
      .header-left img { height: 40px; }
      .header-right img { height: 35px; }
      
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
    ${createPageHeader()}
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
    ${createPageFooter(1)}
  </div>

  <!-- Page 2: End of Day Checklist -->
  <div class="page">
    ${createPageHeader()}
    <div class="page-content">
      ${renderChecklistItems(endOfDay, 'End of Day Checklist')}
    </div>
    ${createPageFooter(2)}
  </div>

  <!-- Page 3: Equipment + Structure Inspections -->
  <div class="page">
    ${createPageHeader()}
    <div class="page-content">
      ${renderChecklistItems(equipmentChecks, 'Equipment Inspection')}
      ${renderChecklistItems(structureChecks, 'Structure Inspection')}
    </div>
    ${createPageFooter(3)}
  </div>

  <!-- Page 4: Environment + Disclaimer -->
  <div class="page">
    ${createPageHeader()}
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
    ${createPageFooter(4)}
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
