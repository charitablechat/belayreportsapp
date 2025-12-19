import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { fetchTrainingData, formatTrainingContent } from "../_shared/training-formatter.ts";

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

function deduplicateHtmlContent(html: string | null): string {
  if (!html) return '';
  
  const listItemRegex = /<li>(.*?)<\/li>/gi;
  const uniqueItems = new Map<string, string>();
  let match;
  
  while ((match = listItemRegex.exec(html)) !== null) {
    const content = match[1].trim();
    const contentLower = content.toLowerCase();
    if (content && !uniqueItems.has(contentLower)) {
      uniqueItems.set(contentLower, content);
    }
  }
  
  if (uniqueItems.size > 0) {
    const items = Array.from(uniqueItems.values()).map(item => `<li>${item}</li>`).join('\n');
    return `<ul>\n${items}\n</ul>`;
  }
  
  const lines = html.split('\n').map(l => l.trim()).filter(Boolean);
  const uniqueLines = new Map<string, string>();
  lines.forEach(line => {
    const lineLower = line.toLowerCase();
    if (!uniqueLines.has(lineLower)) {
      uniqueLines.set(lineLower, line);
    }
  });
  
  return Array.from(uniqueLines.values()).join('\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { trainingId } = await req.json();

    if (!trainingId) {
      throw new Error('Training ID is required');
    }

    // Fetch logos from storage
    const logos = await getLogoBase64(supabaseUrl);
    const ropeWorksLogo = logos.ropeWorks;
    const acctLogo = logos.acct;

    // Fetch training data using shared formatter
    const trainingData = await fetchTrainingData(trainingId, supabase);
    const content = formatTrainingContent(trainingData);

    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Report - ${content.facilityInfo.organization}</title>
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
    .standards-box {
      background: #dbeafe;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 30px;
      color: #1e40af;
      font-size: 14px;
      line-height: 1.6;
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
      padding: 8px 12px;
      margin-bottom: 6px;
      background: #f8fafc;
      border-left: 3px solid #3b82f6;
      border-radius: 2px;
    }
    li strong {
      color: #1e293b;
    }
    li .description {
      color: #64748b;
      font-size: 14px;
      margin-top: 4px;
    }
    .text-content {
      padding: 15px;
      background: #f8fafc;
      border-radius: 4px;
      white-space: pre-wrap;
      line-height: 1.8;
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
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .container {
        box-shadow: none;
        padding: 20px;
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
      
      .section-title {
        font-size: 14px;
        padding: 8px 12px;
      }
      
      li {
        padding: 6px 10px;
        font-size: 13px;
      }
      
      .text-content {
        padding: 10px;
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
        <h1>Training Report</h1>
        <div class="subtitle">Professional Training Documentation</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor" class="badge">
      </div>
    </div>

    <div class="section">
      <div class="section-title">Facility Information</div>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Organization</div>
          <div class="info-value">${content.facilityInfo.organization}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Training Dates</div>
          <div class="info-value">${content.facilityInfo.startDate} - ${content.facilityInfo.endDate}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Trainer of Record</div>
          <div class="info-value">${content.facilityInfo.trainerOfRecord}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Trainee Names</div>
          <div class="info-value">${content.facilityInfo.traineeNames}</div>
        </div>
      </div>
    </div>

    <div class="standards-box">
      ${content.standardsText}
    </div>

    ${content.deliveryApproaches.length > 0 ? `
    <div class="section">
      <div class="section-title">Delivery Approach</div>
      <ul>
        ${content.deliveryApproaches.map(approach => `<li>☑ ${approach}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${content.operatingSystems.length > 0 ? `
    <div class="section">
      <div class="section-title">Trained Operating Systems</div>
      <ul>
        ${content.operatingSystems.map(sys => `
          <li>
            <strong>☑ ${sys.name}</strong>
            ${sys.description ? `<div class="description">${sys.description}</div>` : ''}
          </li>
        `).join('')}
      </ul>
    </div>
    ` : ''}

    ${content.immediateAttention.length > 0 ? `
    <div class="section">
      <div class="section-title" style="background: #dc2626;">Actions Requiring Immediate Attention</div>
      <ul>
        ${content.immediateAttention.map(item => `<li style="border-left-color: #dc2626;">⚠ ${item}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${content.systemsInPlace.length > 0 ? `
    <div class="section">
      <div class="section-title">Systems in Place</div>
      <ul>
        ${content.systemsInPlace.map(item => `<li>☑ ${item}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${content.verifiableItems.length > 0 ? `
    <div class="section">
      <div class="section-title">Items Verified During Training</div>
      <ul>
        ${content.verifiableItems.map(item => `<li>☑ ${item}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${content.summary.observations || content.summary.recommendations ? `
    <div class="section">
      <div class="section-title">Training Summary</div>
      ${content.summary.observations ? `
        <div style="margin-bottom: 20px;">
          <div class="info-label" style="margin-bottom: 8px;">Observations</div>
          <div class="text-content">${deduplicateHtmlContent(content.summary.observations)}</div>
        </div>
      ` : ''}
      ${content.summary.recommendations ? `
        <div style="margin-bottom: 20px;">
          <div class="info-label" style="margin-bottom: 8px;">Recommendations</div>
          <div class="text-content">${deduplicateHtmlContent(content.summary.recommendations)}</div>
        </div>
      ` : ''}
      ${content.summary.personSubmitting || content.summary.submissionDate ? `
      <div class="info-grid">
        ${content.summary.personSubmitting ? `
        <div class="info-item">
          <div class="info-label">Person Submitting</div>
          <div class="info-value">${content.summary.personSubmitting}</div>
        </div>
        ` : ''}
        ${content.summary.submissionDate ? `
        <div class="info-item">
          <div class="info-label">Submission Date</div>
          <div class="info-value">${content.summary.submissionDate}</div>
        </div>
        ` : ''}
      </div>
      ` : ''}
    </div>
    ` : ''}

    <div class="disclaimer">
      <div class="disclaimer-title">DISCLAIMER</div>
      <div class="disclaimer-text">${content.disclaimer}</div>
    </div>

    <div class="footer">
      <p>Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      <p style="margin-top: 5px;">Rope Works Training Report</p>
    </div>
  </div>
</body>
</html>`;

    return new Response(
      JSON.stringify({ html }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error generating HTML report:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
