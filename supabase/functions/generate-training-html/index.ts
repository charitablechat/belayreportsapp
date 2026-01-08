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

    // Helper functions for page header and footer
    const pageHeader = `
      <div class="page-header">
        <div class="header-left">
          <img src="${ropeWorksLogo}" alt="Rope Works Logo">
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
        <div class="footer-text">
          The information contained in this report has been documented by a Qualified Professional.<br>
          This report is effective for one year from the date of inspection. Issued by:<br>
          Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620
        </div>
      </div>
    `;

    // Build systems in place HTML
    const ALL_SYSTEMS_IN_PLACE = [
      'A system for conducting and documenting a periodic internal monitoring of the course, surrounding environment, and equipment',
      'A system in place for incident documentation',
      'A system in place to inform participants of the inherent and other risks associated with participation',
      'A system in place for assessing and confirming activity corridors are clear of obstructions',
      'A system in place to engage a qualified person to review the site\'s risk management and program quality every five years. (CHPT 2 ANSI/ACCT B.2.7)',
      'Unable to check any of the above at this time'
    ];
    
    const systemsInPlaceHtml = ALL_SYSTEMS_IN_PLACE.map(item => {
      const isChecked = content.systemsInPlace.includes(item);
      const checkmark = isChecked ? '☑' : '☐';
      const style = isChecked ? '' : 'style="border-left-color: #94a3b8; background: #f1f5f9;"';
      return `<li ${style}>${checkmark} ${item}</li>`;
    }).join('');

    // Generate HTML with page-based structure
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
    
    /* Page structure for print */
    .page {
      max-width: 100%;
      width: 100%;
      margin: 0 auto 20px auto;
      background: white;
      padding: 0.25in;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      position: relative;
      min-height: 9in;
      max-height: 9.5in;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #1e40af;
      padding-bottom: 15px;
      margin-bottom: 20px;
      position: relative;
      overflow: hidden;
      height: 70px;
      max-height: 70px;
    }
    
    .page-header .header-left {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      overflow: hidden;
    }
    
    .page-header .header-left img {
      height: 55px;
      max-height: 55px;
      max-width: 200px;
      width: auto;
      object-fit: contain;
    }
    
    .page-header .header-right {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      overflow: hidden;
    }
    
    .page-header .header-right img {
      height: 50px;
      max-height: 50px;
      max-width: 180px;
      width: auto;
      object-fit: contain;
    }
    
    .page-footer {
      margin-top: 30px;
      padding-top: 15px;
    }
    
    .page-footer .page-number {
      text-align: center;
      font-size: 10px;
      color: #64748b;
      margin-bottom: 8px;
    }
    
    .page-footer .footer-line {
      border-top: 2px solid #e2e8f0;
      margin-bottom: 15px;
    }
    
    .page-footer .footer-text {
      text-align: center;
      color: #64748b;
      font-size: 11px;
      line-height: 1.5;
    }
    
    .page-content {
      flex: 1;
    }
    
    .page-title {
      color: #1e40af;
      font-size: 28px;
      margin-bottom: 8px;
    }
    
    .page-subtitle {
      color: #64748b;
      font-size: 14px;
      margin-bottom: 20px;
    }
    
    .section {
      margin-bottom: 25px;
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
      margin-bottom: 25px;
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
      margin-bottom: 20px;
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
    .generated-timestamp {
      text-align: center;
      color: #64748b;
      font-size: 12px;
      margin-top: 15px;
    }
    
    @media print {
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
        background: white;
        color: black;
        font-size: 10pt;
        line-height: 1.4;
        padding: 0;
      }

      @page {
        size: letter portrait;
        margin: 0.5in;
      }

      .page {
        display: flex !important;
        flex-direction: column !important;
        position: relative !important;
        min-height: 9in !important;
        height: 9.5in !important;
        max-height: 9.5in !important;
        padding: 0.2in !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        page-break-after: always !important;
        page-break-inside: avoid !important;
        box-shadow: none !important;
        overflow: hidden !important;
      }

      .page:last-child {
        page-break-after: avoid !important;
      }

      .page > .page-header {
        display: flex !important;
        flex-shrink: 0 !important;
        height: 60px !important;
        max-height: 60px !important;
        overflow: hidden !important;
        margin-bottom: 10px !important;
        position: relative !important;
      }
      
      .page > .page-header .header-left,
      .page > .page-header .header-right {
        flex: 0 0 auto !important;
        overflow: hidden !important;
      }
      
      .page > .page-header .header-left img,
      .page > .page-header .header-right img {
        max-height: 50px !important;
        max-width: 180px !important;
        height: auto !important;
        width: auto !important;
        object-fit: contain !important;
      }

      .page-content {
        display: block !important;
        flex: 1 !important;
        overflow: visible !important;
      }

      .page-footer {
        display: block !important;
        flex-shrink: 0 !important;
        margin-top: auto !important;
        padding-top: 10px !important;
      }

      .section {
        page-break-inside: avoid;
      }

      .section-title {
        page-break-after: avoid;
      }

      li {
        page-break-inside: avoid;
      }

      .info-grid,
      .standards-box,
      .disclaimer {
        page-break-inside: avoid;
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
        flex-direction: column;
        text-align: center;
        gap: 10px;
      }
      
      .page-header .header-left, .page-header .header-right {
        text-align: center;
      }
      
      .page-header .logo { max-width: 100px; }
      .page-header .badge { max-width: 80px; }
      
      .page-title { font-size: 20px; }
      
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
      
      .page-footer .footer-text {
        font-size: 10px;
      }
    }

    @media (max-width: 480px) {
      body { padding: 4px; }
      .page { padding: 8px; }
      .page-title { font-size: 18px; }
      .section-title { font-size: 12px; }
    }
  </style>
</head>
<body>
  <!-- Page 1: Cover and Facility Information -->
  <div class="page">
    ${pageHeader}
    <div class="page-content">
      <h1 class="page-title">Training Report</h1>
      <div class="page-subtitle">Professional Training Documentation</div>

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
    </div>
    ${createPageFooter(1)}
  </div>

  <!-- Page 2: Delivery, Operating Systems, Immediate Attention -->
  <div class="page">
    ${pageHeader}
    <div class="page-content">
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
        <p style="margin: 10px 0 15px 0; font-style: italic; color: #666;">This area lists requirements the trainer either noted as a deficiency at your site or a need to update procedures/policy during the operations of your aerial adventure training.</p>
        <ul>
          ${content.immediateAttention.map(item => `<li style="border-left-color: #dc2626;">⚠ ${item}</li>`).join('')}
        </ul>
      </div>
      ` : ''}
    </div>
    ${createPageFooter(2)}
  </div>

  <!-- Page 3: Verifiable Items -->
  <div class="page">
    ${pageHeader}
    <div class="page-content">
      ${content.verifiableItems.length > 0 ? `
      <div class="section">
        <div class="section-title">Items Verified During Training</div>
        <p style="margin: 10px 0 15px 0; font-style: italic; color: #666; line-height: 1.6;">
          It is the responsibility of the client to read, understand, and follow all manufacturer guidelines, notices and recalls for the equipment used for your site's operations. This includes proper documentation and inventory tracking of each item used for course operations. This should be done according to a written checklist that is monitored by the course manager or other qualified person at your site. Records should be available at your annual inspection that include and indicate the date of purchase, date of first use and the equipment shall be identifiable by the serial number/tag or other unique identifier that matches your written documentation and the manufacturer retirement criteria.
        </p>
        <p style="margin: 0 0 15px 0; font-weight: 600; color: #333;">
          CHECK ONLY THOSE THAT WERE VERIFIABLE AND IN PLACE DURING TRAINING.
        </p>
        <ul>
          ${content.verifiableItems.map(item => `<li>☑ ${item}</li>`).join('')}
        </ul>
      </div>
      ` : `
      <div class="section">
        <div class="section-title">Items Verified During Training</div>
        <p style="margin: 10px 0 15px 0; font-style: italic; color: #666;">No items were verified during this training session.</p>
      </div>
      `}
    </div>
    ${createPageFooter(3)}
  </div>

  <!-- Page 4: Systems in Place -->
  <div class="page">
    ${pageHeader}
    <div class="page-content">
      <div class="section">
        <div class="section-title">Systems in Place</div>
        <p style="margin: 10px 0 8px 0; font-weight: 600; color: #333;">
          Check ONLY if the following are in place:
        </p>
        <p style="margin: 0 0 15px 0; font-style: italic; color: #666; line-height: 1.6;">
          The following were either addressed in discussion with training participants or a staff supervisor. We recommend following up to address any unchecked areas.
        </p>
        <ul>
          ${systemsInPlaceHtml}
        </ul>
      </div>
    </div>
    ${createPageFooter(4)}
  </div>

  <!-- Page 5: Training Summary -->
  <div class="page">
    ${pageHeader}
    <div class="page-content">
      ${content.summary.observations || content.summary.recommendations ? `
      <div class="section">
        <div class="section-title">Training Summary</div>
        ${content.summary.observations ? `
          <div style="margin-bottom: 20px;">
            <div class="info-label" style="margin-bottom: 8px;">Training Observations</div>
            <p style="margin: 0 0 12px 0; font-style: italic; color: #666; line-height: 1.5; font-size: 14px;">
              This area lists/describes any observations at the time of training pertaining to staff, equipment function, or operations:
            </p>
            <div class="text-content">${deduplicateHtmlContent(content.summary.observations)}</div>
          </div>
        ` : ''}
        ${content.summary.recommendations ? `
          <div style="margin-bottom: 20px;">
            <div class="info-label" style="margin-bottom: 8px;">Training Recommendations</div>
            <p style="margin: 0 0 12px 0; font-style: italic; color: #666; line-height: 1.5; font-size: 14px;">
              This area lists recommendations from the trainer after visiting your site regarding staff, equipment function, or operations:
            </p>
            <div class="text-content">${deduplicateHtmlContent(content.summary.recommendations)}</div>
          </div>
        ` : ''}
      </div>
      ` : `
      <div class="section">
        <div class="section-title">Training Summary</div>
        <p style="margin: 10px 0 15px 0; font-style: italic; color: #666;">No observations or recommendations were recorded for this training session.</p>
      </div>
      `}
    </div>
    ${createPageFooter(5)}
  </div>

  <!-- Page 6: Submission and Disclaimer -->
  <div class="page">
    ${pageHeader}
    <div class="page-content">
      ${content.summary.personSubmitting || content.summary.submissionDate ? `
      <div class="section">
        <div class="section-title">Person Submitting Form</div>
        <p style="margin: 0 0 16px 0; font-style: italic; color: #666; line-height: 1.5; font-size: 14px;">
          The trainer listed on this report verifies the report is complete and ready for client submission on the following date.
        </p>
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
      </div>
      ` : ''}

      <div class="disclaimer">
        <div class="disclaimer-title">DISCLAIMER</div>
        <div class="disclaimer-text">${content.disclaimer}</div>
      </div>

      <div class="generated-timestamp">
        Generated on ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
    ${createPageFooter(6)}
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
