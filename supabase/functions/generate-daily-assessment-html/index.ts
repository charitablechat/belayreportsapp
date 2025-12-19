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

    const formatDate = (dateStr: string) => {
      if (!dateStr) return 'N/A';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

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

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Course Assessment - ${assessment.site}</title>
  <style>
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

    .container {
      max-width: 100%;
      width: 100%;
      margin: 0 auto;
      background: white;
      padding: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #1e40af;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }

    .header-left {
      flex: 1;
    }

    .header-right {
      text-align: right;
    }

    .logo {
      max-width: 150px;
      margin-bottom: 10px;
    }

    .badge {
      max-width: 120px;
    }

    h1 {
      color: #1e40af;
      font-size: 32px;
      margin-bottom: 10px;
    }

    .subtitle {
      color: #64748b;
      font-size: 14px;
    }

    .section {
      margin-bottom: 30px;
    }

    .section-title {
      background: #1e40af;
      color: white;
      padding: 12px 20px;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 15px;
      border-radius: 4px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
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
      font-size: 13px;
      margin-bottom: 4px;
    }

    .info-value {
      color: #1e293b;
    }

    ul {
      list-style: none;
      padding-left: 0;
    }

    li {
      display: flex;
      gap: 12px;
      padding: 10px 12px;
      margin-bottom: 8px;
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
      font-size: 18px;
      font-weight: bold;
      flex-shrink: 0;
      width: 24px;
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
    }

    .item-comments {
      font-size: 13px;
      color: #64748b;
      font-style: italic;
      margin-top: 4px;
    }

    .systems-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .system-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: #f8fafc;
      border-left: 3px solid #22c55e;
      border-radius: 2px;
    }

    .system-item .checkbox-icon {
      color: #22c55e;
      font-size: 18px;
    }

    .disclaimer {
      background: #fef3c7;
      padding: 15px;
      border-radius: 4px;
      border-left: 4px solid #f59e0b;
      margin-top: 30px;
    }

    .disclaimer-title {
      font-weight: 700;
      color: #92400e;
      margin-bottom: 8px;
    }

    .disclaimer-text {
      color: #78350f;
      font-size: 13px;
      line-height: 1.6;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }

    .page-break {
      page-break-before: always;
      margin-top: 30px;
    }

    @media print {
      body {
        background: white;
        padding: 0;
      }
      .container {
        box-shadow: none;
        padding: 20px;
      }
      .page-break {
        page-break-before: always;
      }
    }

    @media (max-width: 768px) {
      html, body {
        max-width: 100vw;
        overflow-x: hidden;
      }
      
      body { padding: 8px; }
      
      .container {
        padding: 12px;
      }
      
      .header {
        flex-direction: column;
        text-align: center;
        gap: 10px;
      }
      
      .header-left, .header-right {
        text-align: center;
      }
      
      .logo { max-width: 100px; }
      .badge { max-width: 80px; }
      
      h1 { font-size: 20px; }
      
      .info-grid {
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .info-item.full-width {
        grid-column: span 1;
      }
      
      .section-title {
        font-size: 14px;
        padding: 8px 12px;
      }

      .systems-grid {
        grid-template-columns: 1fr;
      }
      
      li {
        padding: 8px 10px;
        font-size: 13px;
      }
      
      .disclaimer {
        padding: 10px;
        font-size: 11px;
      }
    }

    @media (max-width: 480px) {
      body { padding: 4px; }
      .container { padding: 8px; }
      h1 { font-size: 18px; }
      .section-title { font-size: 12px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <img src="${ropeWorksLogo}" alt="Rope Works Logo" class="logo">
        <h1>Daily Course Assessment</h1>
        <div class="subtitle">Challenge Course Operations Documentation</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor" class="badge">
      </div>
    </div>

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
    ${renderChecklistItems(endOfDay, 'End of Day Checklist')}

    <div class="page-break"></div>

    ${renderChecklistItems(equipmentChecks, 'Equipment Inspection')}
    ${renderChecklistItems(structureChecks, 'Structure Inspection')}
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

    <div class="footer">
      <p>Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      <p style="margin-top: 5px;">Rope Works Daily Course Assessment | ${assessment.site || 'N/A'}</p>
    </div>
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
