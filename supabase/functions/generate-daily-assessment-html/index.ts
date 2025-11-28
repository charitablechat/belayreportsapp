import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Embedded logos as base64 - will be fetched from storage
let ROPE_WORKS_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let ACCT_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function getLogoBase64(supabaseUrl: string): Promise<{ropeWorks: string, acct: string}> {
  try {
    const ropeWorksUrl = `${supabaseUrl}/storage/v1/object/public/pdf-templates/rope-works-logo-embedded.png`;
    const acctUrl = `${supabaseUrl}/storage/v1/object/public/pdf-templates/acct-logo-embedded.png`;
    const [ropeWorksResponse, acctResponse] = await Promise.all([fetch(ropeWorksUrl), fetch(acctUrl)]);
    if (ropeWorksResponse.ok && acctResponse.ok) {
      const [ropeWorksBlob, acctBlob] = await Promise.all([ropeWorksResponse.blob(), acctResponse.blob()]);
      const [ropeWorksBuffer, acctBuffer] = await Promise.all([ropeWorksBlob.arrayBuffer(), acctBlob.arrayBuffer()]);
      const ropeWorksBase64 = btoa(String.fromCharCode(...new Uint8Array(ropeWorksBuffer)));
      const acctBase64 = btoa(String.fromCharCode(...new Uint8Array(acctBuffer)));
      return { ropeWorks: `data:image/png;base64,${ropeWorksBase64}`, acct: `data:image/png;base64,${acctBase64}` };
    }
  } catch (error) { console.warn('Failed to fetch logos from storage, using placeholders:', error); }
  return { ropeWorks: ROPE_WORKS_LOGO, acct: ACCT_LOGO };
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

    const formatDate = (dateStr: string) => {
      if (!dateStr) return 'N/A';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const renderChecklistItems = (items: any[] | null, title: string) => {
      if (!items || items.length === 0) return '';
      return `
        <div class="section">
          <h2>${title}</h2>
          ${items.map(item => `
            <div class="checklist-item">
              <div class="checkbox ${item.is_complete || item.is_checked ? 'checked' : ''}">
                ${item.is_complete || item.is_checked ? '✓' : ''}
              </div>
              <div class="item-content">
                <div class="item-label">${item.item_key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</div>
                ${item.comments ? `<div class="item-comments">${item.comments}</div>` : ''}
              </div>
            </div>
          `).join('')}
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
    @page {
      size: letter;
      margin: 0.5in;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #000;
    }

    .page {
      page-break-after: always;
      position: relative;
      min-height: 100vh;
      padding-bottom: 60px;
    }

    .page:last-child {
      page-break-after: avoid;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #1e40af;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }

    .logo {
      height: 60px;
      width: auto;
    }

    .page-title {
      text-align: center;
      flex: 1;
      margin: 0 20px;
    }

    .page-title h1 {
      font-size: 20pt;
      color: #1e40af;
      margin-bottom: 5px;
    }

    .page-title .subtitle {
      font-size: 12pt;
      color: #666;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-bottom: 25px;
      background: #f8fafc;
      padding: 15px;
      border-radius: 8px;
    }

    .info-item {
      display: flex;
      flex-direction: column;
    }

    .info-label {
      font-weight: bold;
      font-size: 10pt;
      color: #666;
      margin-bottom: 3px;
    }

    .info-value {
      font-size: 11pt;
      color: #000;
    }

    .section {
      margin-bottom: 25px;
    }

    .section h2 {
      font-size: 14pt;
      color: #1e40af;
      border-bottom: 2px solid #1e40af;
      padding-bottom: 8px;
      margin-bottom: 15px;
    }

    .checklist-item {
      display: flex;
      gap: 12px;
      margin-bottom: 15px;
      padding: 10px;
      background: #f8fafc;
      border-radius: 6px;
    }

    .checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid #1e40af;
      border-radius: 4px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14pt;
      font-weight: bold;
      color: #1e40af;
    }

    .checkbox.checked {
      background: #1e40af;
      color: white;
    }

    .item-content {
      flex: 1;
    }

    .item-label {
      font-weight: bold;
      margin-bottom: 5px;
    }

    .item-comments {
      font-size: 10pt;
      color: #666;
      font-style: italic;
      margin-top: 5px;
    }

    .systems-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .system-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: #f8fafc;
      border-radius: 4px;
    }

    .page-footer {
      position: fixed;
      bottom: 20px;
      left: 0.5in;
      right: 0.5in;
      text-align: center;
      font-size: 9pt;
      color: #666;
      border-top: 1px solid #ccc;
      padding-top: 10px;
    }

    @media print {
      .page {
        page-break-after: always;
      }
      .page:last-child {
        page-break-after: avoid;
      }
    }
  </style>
</head>
<body>
  <!-- Page 1: Header & Basic Info -->
  <div class="page">
    <div class="page-header">
      ${acctLogo ? `<img src="${acctLogo}" alt="ACCT Logo" class="logo">` : ''}
      <div class="page-title">
        <h1>Daily Course Assessment</h1>
        <div class="subtitle">Challenge Course Operations</div>
      </div>
      ${ropeWorksLogo ? `<img src="${ropeWorksLogo}" alt="Rope Works Logo" class="logo">` : ''}
    </div>

    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Date</div>
        <div class="info-value">${formatDate(assessment.assessment_date)}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Site</div>
        <div class="info-value">${assessment.site || 'N/A'}</div>
      </div>
      <div class="info-item" style="grid-column: span 2">
        <div class="info-label">Trainer/Facilitator of Record</div>
        <div class="info-value">${assessment.trainer_of_record || 'N/A'}</div>
      </div>
    </div>

    ${renderChecklistItems(bodData.data, 'Beginning of Day Checklist')}
    ${renderChecklistItems(eodData.data, 'End of Day Checklist')}

    <div class="section">
      <h2>Operating Systems in Use Today</h2>
      <div class="systems-grid">
        ${osData.data?.map(s => `
          <div class="system-item">
            <div class="checkbox checked">✓</div>
            <span>${s.system_name}</span>
          </div>
        `).join('') || '<p>No systems recorded</p>'}
      </div>
    </div>

    <div class="page-footer">
      <p>Daily Course Assessment | ${assessment.site || 'N/A'} | ${formatDate(assessment.assessment_date)}</p>
    </div>
  </div>

  <!-- Page 2: Pre-Use Inspections -->
  <div class="page">
    <div class="page-header">
      ${acctLogo ? `<img src="${acctLogo}" alt="ACCT Logo" class="logo">` : ''}
      <div class="page-title">
        <h1>Pre-Use Inspections</h1>
        <div class="subtitle">${assessment.site || 'N/A'}</div>
      </div>
      ${ropeWorksLogo ? `<img src="${ropeWorksLogo}" alt="Rope Works Logo" class="logo">` : ''}
    </div>

    ${renderChecklistItems(eqData.data, 'Equipment Inspection')}
    ${renderChecklistItems(stData.data, 'Structure Inspection')}
    ${renderChecklistItems(envData.data, 'Environment Inspection')}

    <div class="page-footer">
      <p>Daily Course Assessment | ${assessment.site || 'N/A'} | ${formatDate(assessment.assessment_date)} | Page 2</p>
    </div>
  </div>
</body>
</html>
    `;

    return new Response(
      JSON.stringify({ html }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error generating HTML:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
