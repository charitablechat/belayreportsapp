import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Embedded logos as base64 - will be fetched from storage
let ROPE_WORKS_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let ACCT_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function getLogoBase64(supabaseUrl: string): Promise<{ropeWorks: string, acct: string}> {
  // Try fetching from storage bucket first (admin uploaded logos)
  try {
    const ropeWorksUrl = `${supabaseUrl}/storage/v1/object/public/pdf-templates/rope-works-logo-embedded.png`;
    const acctUrl = `${supabaseUrl}/storage/v1/object/public/pdf-templates/acct-logo-embedded.png`;
    
    const [ropeWorksResponse, acctResponse] = await Promise.all([
      fetch(ropeWorksUrl),
      fetch(acctUrl)
    ]);
    
    if (ropeWorksResponse.ok && acctResponse.ok) {
      const [ropeWorksBlob, acctBlob] = await Promise.all([
        ropeWorksResponse.blob(),
        acctResponse.blob()
      ]);
      
      const [ropeWorksBuffer, acctBuffer] = await Promise.all([
        ropeWorksBlob.arrayBuffer(),
        acctBlob.arrayBuffer()
      ]);
      
      const ropeWorksBase64 = btoa(String.fromCharCode(...new Uint8Array(ropeWorksBuffer)));
      const acctBase64 = btoa(String.fromCharCode(...new Uint8Array(acctBuffer)));
      
      return {
        ropeWorks: `data:image/png;base64,${ropeWorksBase64}`,
        acct: `data:image/png;base64,${acctBase64}`
      };
    }
  } catch (error) {
    console.log('Storage logos not found, trying public folder...');
  }
  
  // Fallback: Try fetching from public folder (deployed assets)
  try {
    const baseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co';
    const ropeWorksPublicUrl = `${baseUrl}/storage/v1/object/public/pdf-templates/rope-works-logo.png`;
    const acctPublicUrl = `${baseUrl}/storage/v1/object/public/pdf-templates/acct-accredited-vendor.png`;
    
    const [ropeWorksResponse, acctResponse] = await Promise.all([
      fetch(ropeWorksPublicUrl),
      fetch(acctPublicUrl)
    ]);
    
    if (ropeWorksResponse.ok && acctResponse.ok) {
      const [ropeWorksBlob, acctBlob] = await Promise.all([
        ropeWorksResponse.blob(),
        acctResponse.blob()
      ]);
      
      const [ropeWorksBuffer, acctBuffer] = await Promise.all([
        ropeWorksBlob.arrayBuffer(),
        acctBlob.arrayBuffer()
      ]);
      
      const ropeWorksBase64 = btoa(String.fromCharCode(...new Uint8Array(ropeWorksBuffer)));
      const acctBase64 = btoa(String.fromCharCode(...new Uint8Array(acctBuffer)));
      
      console.log('Successfully loaded logos from public folder');
      return {
        ropeWorks: `data:image/png;base64,${ropeWorksBase64}`,
        acct: `data:image/png;base64,${acctBase64}`
      };
    }
  } catch (error) {
    console.warn('Failed to fetch logos from public folder:', error);
  }
  
  // Final fallback: use placeholders (will be invisible instead of purple)
  console.warn('Using placeholder logos - logos may not display correctly');
  return {
    ropeWorks: ROPE_WORKS_LOGO,
    acct: ACCT_LOGO
  };
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { inspectionId } = await req.json();

    if (!inspectionId) {
      throw new Error("Inspection ID is required");
    }

    console.log(`Generating HTML for inspection: ${inspectionId}`);

    // Fetch logos from storage
    const logos = await getLogoBase64(supabaseUrl);
    const ropeWorksLogo = logos.ropeWorks;
    const acctLogo = logos.acct;

    // Fetch all inspection data
    const { data: inspection, error: inspectionError } = await supabase
      .from("inspections")
      .select(`
        *,
        profiles!inspections_inspector_id_profiles_fkey (
          first_name,
          last_name,
          acct_number
        )
      `)
      .eq("id", inspectionId)
      .single();

    if (inspectionError) throw inspectionError;
    if (!inspection) throw new Error("Inspection not found");

    // Fetch related data
    const [equipmentRes, standardsRes, systemsRes, ziplinesRes, summaryRes] = await Promise.all([
      supabase.from("inspection_equipment").select("*").eq("inspection_id", inspectionId),
      supabase.from("inspection_standards").select("*").eq("inspection_id", inspectionId),
      supabase.from("inspection_systems").select("*").eq("inspection_id", inspectionId),
      supabase.from("inspection_ziplines").select("*").eq("inspection_id", inspectionId),
      supabase.from("inspection_summary").select("*").eq("inspection_id", inspectionId).single(),
    ]);

    const equipment = equipmentRes.data || [];
    const standards = standardsRes.data || [];
    const systems = systemsRes.data || [];
    const ziplines = ziplinesRes.data || [];
    const summary = summaryRes.data;

    // Format dates
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return "N/A";
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    };

    const inspectorName = inspection.profiles
      ? `${inspection.profiles.first_name || ""} ${inspection.profiles.last_name || ""}`.trim() || "Unknown"
      : "Unknown";
    const acctNumber = inspection.profiles?.acct_number || inspection.acct_number || "N/A";

    // Content volume calculation for page consolidation
    const COMBINE_THRESHOLD = 4; // Maximum rows to consider for combining pages
    const systemsRowCount = systems.length;
    const ziplinesRowCount = ziplines.length;
    const equipmentRowCount = equipment.length;
    const standardsRowCount = standards.length;
    
    // Determine which pages can be combined
    const canCombineSystemsZiplines = systemsRowCount > 0 && ziplinesRowCount > 0 && 
                                       systemsRowCount <= COMBINE_THRESHOLD && ziplinesRowCount <= COMBINE_THRESHOLD;
    const canCombineEquipmentStandards = equipmentRowCount > 0 && standardsRowCount > 0 && 
                                          equipmentRowCount <= 6 && standardsRowCount <= 6;

    // Calculate page count with consolidation
    let pageCount = 2; // Cover + Key
    
    if (canCombineSystemsZiplines) {
      pageCount++; // Combined systems/ziplines page
    } else {
      if (systems.length > 0) pageCount++;
      if (ziplines.length > 0) pageCount++;
    }
    
    if (canCombineEquipmentStandards) {
      pageCount++; // Combined equipment/standards page
    } else {
      if (equipment.length > 0) pageCount++;
      if (standards.length > 0) pageCount++;
    }
    
    if (summary) pageCount++;

    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inspection Report - ${inspection.organization}</title>
  <style>
    @page {
      size: letter;
      margin: 0.5in;
    }

    :root {
      --spacing-tight: 8px;
      --spacing-normal: 12px;
      --spacing-relaxed: 16px;
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
      background: #fff;
    }

    .page {
      display: flex;
      flex-direction: column;
      min-height: auto;
      padding: 0.5in;
      padding-bottom: 0.75in;
      page-break-after: always;
    }
    
    .page-content {
      flex: 1 0 auto;
    }

    .page:last-child {
      page-break-after: avoid;
    }

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
      height: 70px;
      width: auto;
      object-fit: contain;
    }

    .header-center {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
    }

    .header-title {
      font-size: 11pt;
      font-weight: bold;
      color: #1e40af;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      white-space: nowrap;
    }

    .header-right {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }

    .header-right img {
      height: 60px;
      width: auto;
      object-fit: contain;
    }

    .page-footer {
      position: relative;
      margin-top: auto;
      font-size: 9pt;
      color: #666;
      border-top: 1px solid #ddd;
      padding-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 15px;
    }

    .disclaimer {
      flex: 1;
      line-height: 1.4;
      font-size: 8.5pt;
    }

    .page-number {
      font-weight: bold;
      white-space: nowrap;
      font-size: 9pt;
      color: #333;
    }

    h1 {
      font-size: 24pt;
      color: #1e40af;
      margin-bottom: 15px;
      font-weight: bold;
      line-height: 1.3;
    }

    h2 {
      font-size: 16pt;
      color: #1e40af;
      margin: 12px 0 8px 0;
      font-weight: bold;
      line-height: 1.4;
    }

    h3 {
      font-size: 13pt;
      color: #000;
      margin: 10px 0 6px 0;
      font-weight: bold;
      line-height: 1.3;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      margin: 12px 0;
      border: 1px solid #ddd;
    }

    .info-cell {
      padding: 8px 10px;
      border-right: 1px solid #ddd;
      border-bottom: 1px solid #ddd;
    }

    .info-cell:nth-child(2n) {
      border-right: none;
    }

    .info-label {
      font-weight: bold;
      font-size: 9.5pt;
      margin-bottom: 3px;
      color: #333;
    }

    .info-value {
      font-size: 11pt;
      color: #000;
      line-height: 1.4;
    }

    .text-block {
      margin: 10px 0;
      padding: 10px 14px;
      background: #f9f9f9;
      border-left: 4px solid #1e40af;
      font-size: 10pt;
      line-height: 1.7;
    }

    .bullet-list {
      margin: 8px 0 8px 25px;
      font-size: 10pt;
    }

    .bullet-list li {
      margin-bottom: 8px;
      line-height: 1.6;
      padding-left: 5px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 9.5pt;
    }

    table th {
      background: #1e40af;
      color: #fff;
      padding: 6px 8px;
      text-align: left;
      font-weight: bold;
      border: 1px solid #1e40af;
      font-size: 10pt;
    }

    table td {
      padding: 6px 8px;
      border: 1px solid #ddd;
      vertical-align: top;
      line-height: 1.4;
    }

    table tr:nth-child(even) {
      background: #f9f9f9;
    }

    .result-pass {
      color: #16a34a;
      font-weight: bold;
    }

    .result-attention {
      color: #ea580c;
      font-weight: bold;
    }

    .result-fail {
      color: #dc2626;
      font-weight: bold;
    }

    .key-section {
      margin: 10px 0;
      padding: 10px 14px;
      background: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 2px;
    }

    .key-section h3 {
      margin-top: 0;
      margin-bottom: 6px;
    }

    .key-section p {
      line-height: 1.6;
      font-size: 10pt;
    }

    .disclaimer {
      font-size: 8pt;
      color: #666;
      line-height: 1.5;
      font-style: italic;
      max-width: 75%;
    }

    .critical-box {
      background: #fee;
      border: 2px solid #dc2626;
      padding: 12px 14px;
      margin: 10px 0;
      border-radius: 2px;
    }

    .critical-box h3 {
      color: #dc2626;
      margin-top: 0;
      margin-bottom: 10px;
    }

    .combined-section {
      margin-bottom: 25px;
    }

    .combined-section:last-child {
      margin-bottom: 0;
    }

    .section-divider {
      border-top: 2px solid #e5e7eb;
      margin: 20px 0;
    }

    @media print {
      /* Force accurate color reproduction */
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
        background: white;
        color: black;
      }

      /* Page setup and margins */
      @page {
        size: letter portrait;
        margin: 0.5in;
      }

      /* Page break controls */
      .page {
        display: flex;
        flex-direction: column;
        page-break-after: always;
        page-break-inside: avoid;
        min-height: auto;
        margin: 0;
        padding: 0.5in;
        padding-bottom: 0.6in;
      }
      
      .page-content {
        flex: 1 0 auto;
      }
      
      .page:last-child {
        page-break-after: avoid;
      }

      /* Prevent breaks within critical elements */
      .page-header,
      .info-grid,
      .key-section,
      .critical-box,
      .text-block,
      h1, h2, h3 {
        page-break-inside: avoid;
        page-break-after: avoid;
      }

      /* Table break handling */
      table {
        page-break-inside: avoid;
        width: 100%;
      }

      thead {
        display: table-header-group;
      }

      tbody {
        display: table-row-group;
      }

      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }

      /* Ensure headers stay with following content */
      h2, h3 {
        page-break-after: avoid;
        orphans: 3;
        widows: 3;
      }

      h2 + *, h3 + * {
        page-break-before: avoid;
      }

      /* Optimize images for print */
      img {
        max-width: 100%;
        page-break-inside: avoid;
        display: block;
      }

      /* Background colors and borders for print */
      .result-pass {
        color: #16a34a !important;
        font-weight: bold;
      }

      .result-attention {
        color: #ea580c !important;
        font-weight: bold;
      }

      .result-fail {
        color: #dc2626 !important;
        font-weight: bold;
      }

      /* Ensure colored backgrounds print properly */
      .key-section {
        background: #f8f9fa !important;
        border: 1px solid #333 !important;
        page-break-inside: avoid;
      }

      .critical-box {
        background: #fef2f2 !important;
        border: 2px solid #dc2626 !important;
        page-break-inside: avoid;
      }

      .info-grid {
        background: #f9fafb !important;
      }

      /* Table styling for print */
      table {
        border-collapse: collapse;
      }

      table th {
        background: #1e40af !important;
        color: white !important;
        border: 1px solid #1e40af !important;
      }

      table td {
        border: 1px solid #333 !important;
      }

      table tr:nth-child(even) {
        background: #f9f9f9 !important;
      }

      /* Footer positioning for print */
      .page-footer {
        position: relative;
        margin-top: auto;
        page-break-inside: avoid;
        padding-top: 8px;
      }

      /* Text optimization */
      body, p, li, td {
        orphans: 3;
        widows: 3;
      }

      /* Remove unnecessary spacing in print */
      .page-header {
        margin-bottom: 12px;
        padding-bottom: 8px;
      }

      h2 {
        margin: 10px 0 6px 0;
      }

      h3 {
        margin: 8px 0 5px 0;
      }

      .info-grid {
        margin: 10px 0;
      }

      .info-cell {
        padding: 6px 8px;
      }

      .key-section, .text-block {
        padding: 8px 12px;
        margin: 8px 0;
      }

      .critical-box {
        padding: 10px 12px;
        margin: 8px 0;
      }

      table {
        margin: 8px 0;
      }

      table th {
        padding: 5px 7px;
      }

      table td {
        padding: 5px 7px;
        line-height: 1.3;
      }

      .bullet-list {
        margin: 6px 0 6px 20px;
      }

      .bullet-list li {
        margin-bottom: 6px;
      }

      /* Ensure borders print properly */
      .page-header {
        border-bottom: 3px solid #1e40af !important;
      }

      .page-footer {
        border-top: 1px solid #333 !important;
      }

      /* List styling for print */
      ul, ol {
        page-break-inside: avoid;
        margin-left: 20px;
      }

      li {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>

  <!-- PAGE 1: COVER PAGE -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <h1 style="text-align: center; margin-top: 10px;">Professional Inspection for Aerial Adventure Programs</h1>

      <div class="info-grid">
        <div class="info-cell">
          <div class="info-label">Organization:</div>
          <div class="info-value">${inspection.organization}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">Location:</div>
          <div class="info-value">${inspection.location}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">Onsite Contact:</div>
          <div class="info-value">${inspection.onsite_contact || 'N/A'}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">ACCT Course Number:</div>
          <div class="info-value">${acctNumber}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">Inspected by:</div>
          <div class="info-value">${inspectorName}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">Inspector ACCT #:</div>
          <div class="info-value">${acctNumber}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">Date of Inspection:</div>
          <div class="info-value">${formatDate(inspection.inspection_date)}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">Next Inspection Date:</div>
          <div class="info-value">${summary?.next_inspection_date ? formatDate(summary.next_inspection_date) : 'TBD'}</div>
        </div>
        ${inspection.previous_inspector ? `
        <div class="info-cell">
          <div class="info-label">Previously Inspected by:</div>
          <div class="info-value">${inspection.previous_inspector}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">Prev. Inspection Date:</div>
          <div class="info-value">${formatDate(inspection.previous_inspection_date)}</div>
        </div>
        ` : ''}
      </div>

      <h2>Known Course History</h2>
      ${inspection.course_history ? `
      <div class="text-block">${inspection.course_history}</div>
      ` : `
      <div class="text-block">
        <p style="margin-bottom: 10px;">This report covers the condition of the aerial adventure site for the date of inspection reflected on this form.</p>
        <p style="margin-bottom: 10px;">The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course.</p>
        <p style="margin-bottom: 10px;">The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation.</p>
        <p style="margin-bottom: 10px;">Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee.</p>
        <p style="margin-bottom: 0;">We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.</p>
      </div>
      `}

      <h2>Reminders and Requirements</h2>
      <ul class="bullet-list">
        <li><strong>Fall Protection:</strong> Employers are required to issue staff appropriate fall protection for the duties to be performed.</li>
        <li><strong>Periodic Internal Monitoring:</strong> A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.</li>
        <li><strong>Equipment Documentation:</strong> Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.</li>
        <li><strong>Staff Training:</strong> Proper staff training should be provided for the operation of all aerial activities and equipment on your site.</li>
        <li><strong>Operational Reviews:</strong> Operational Reviews shall be conducted once every five years by a qualified professional in accordance with ACCT Standards.</li>
      </ul>
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards. This report is effective for one year from the date of inspection.<br>
        <strong>Rope Works Inc.</strong> | PO Box 1074, Dripping Springs, TX 78620 | www.ropeworksinc.com
      </div>
      <div class="page-number">Page 1 of ${pageCount}</div>
    </div>
  </div>

  <!-- PAGE 2: INSPECTION KEY -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 5px;">Inspection Categories</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">All inspections include the following categories when applicable:</p>

      <div class="key-section">
        <h3>Lifeline HDW (Hardware)</h3>
        <p>Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, and redundant terminations.</p>
      </div>

      <div class="key-section">
        <h3>Activity HDW (Hardware)</h3>
        <p>Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, and structural components.</p>
      </div>

      <div class="key-section">
        <h3>Environment</h3>
        <p>This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, fall zones, trees, rocks, terrain, and clearances.</p>
      </div>

      <div class="key-section">
        <h3>Equipment</h3>
        <p>This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, harnesses, and rescue equipment.</p>
      </div>

      <h2 style="margin-top: 30px;">Inspection Results Key</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        This represents the overall rating for each system based on the condition of the items inspected on the day of the inspection. 
        Rope Works Inc. inspects all challenge course and canopy/zip line tours to the standards set forth by the Association for Challenge Course Technology (ACCT). 
        Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the comments section.
      </p>

      <div class="key-section" style="background: #f0f9ff; border-left: 4px solid #16a34a;">
        <h3 style="color: #16a34a;">Pass</h3>
        <p>The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection. No corrective actions are necessary. The item is approved for continued use until the next scheduled inspection.</p>
      </div>

      <div class="key-section" style="background: #fff7ed; border-left: 4px solid #ea580c;">
        <h3 style="color: #ea580c;">Pass with Provisions</h3>
        <p>The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern. The item may remain in service under specified conditions or with specific limitations until the required actions are completed. A timeline for resolution should be established.</p>
      </div>

      <div class="key-section" style="background: #fef2f2; border-left: 4px solid #dc2626;">
        <h3 style="color: #dc2626;">Fail</h3>
        <p>The equipment or operating system does not meet minimum safety standards and poses a risk to participants or staff. <strong>Immediate corrective action is required.</strong> The item must be removed from service until all necessary repairs, replacements, or modifications are completed and verified by a qualified professional.</p>
      </div>

      <div class="key-section">
        <h3>N/A (Not Applicable)</h3>
        <p>The inspection criterion does not apply to this particular system, element, or piece of equipment at this time.</p>
      </div>
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards and industry best practices.
      </div>
      <div class="page-number">Page 2 of ${pageCount}</div>
    </div>
  </div>

  <!-- PAGE 3: OPERATING SYSTEMS & ZIPLINES (COMBINED OR SEPARATE) -->
  ${canCombineSystemsZiplines ? `
  <!-- COMBINED SYSTEMS & ZIPLINES PAGE -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <!-- Operating Systems Section -->
      <div class="combined-section">
        <h2>Operating Systems</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          Each operating system has been inspected for structural integrity, hardware condition, and environmental factors.
        </p>
        <table>
          <thead>
            <tr>
              <th style="width: 25%;">System Name</th>
              <th style="width: 15%;">Name/ID</th>
              <th style="width: 15%;">Lifeline HDW</th>
              <th style="width: 15%;">Activity HDW</th>
              <th style="width: 30%;">Comments</th>
            </tr>
          </thead>
          <tbody>
            ${systems.map(sys => {
              let resultClass = 'result-pass';
              if (sys.result === 'Needs Attention' || sys.result === 'Pass with Provisions') resultClass = 'result-attention';
              if (sys.result === 'Fail') resultClass = 'result-fail';
              
              return `
                <tr>
                  <td><strong>${sys.system_name}</strong></td>
                  <td>${sys.name || 'N/A'}</td>
                  <td class="${resultClass}">${sys.result}</td>
                  <td class="${resultClass}">${sys.result}</td>
                  <td style="font-size: 9pt;">${sys.comments || '—'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="section-divider"></div>

      <!-- Ziplines Section -->
      <div class="combined-section">
        <h2>Ziplines</h2>
        
        <div style="margin-bottom: 12px; font-size: 9.5pt; padding: 10px; background: #f8f9fa; border-left: 3px solid #1e40af;">
          <strong>Key Abbreviations:</strong><br>
          <strong>Cable Type:</strong> GAC = Galvanized Aircraft Cable, SS = Stainless Steel<br>
          <strong>Braking System:</strong> ZS = Zipstop, FB = Friction Brake, SB = Spring Brake, G = Gravity<br>
          <strong>EAD System:</strong> Energy Absorption Device
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 15%;">Zipline Name</th>
              <th style="width: 8%;">Cable Type</th>
              <th style="width: 8%;">Length (ft)</th>
              <th style="width: 10%;">Cable Result</th>
              <th style="width: 10%;">Braking System</th>
              <th style="width: 10%;">Braking Result</th>
              <th style="width: 8%;">EAD System</th>
              <th style="width: 10%;">EAD Result</th>
              <th style="width: 21%;">Comments</th>
            </tr>
          </thead>
          <tbody>
            ${ziplines.map(zip => {
              const getCableResultClass = () => {
                if (zip.cable_result === 'Pass') return 'result-pass';
                if (zip.cable_result === 'Needs Attention' || zip.cable_result === 'Pass with Provisions') return 'result-attention';
                if (zip.cable_result === 'Fail') return 'result-fail';
                return '';
              };

              const getBrakingResultClass = () => {
                if (zip.braking_result === 'Pass') return 'result-pass';
                if (zip.braking_result === 'Needs Attention' || zip.braking_result === 'Pass with Provisions') return 'result-attention';
                if (zip.braking_result === 'Fail') return 'result-fail';
                return '';
              };

              const getEadResultClass = () => {
                if (zip.ead_result === 'Pass') return 'result-pass';
                if (zip.ead_result === 'Needs Attention' || zip.ead_result === 'Pass with Provisions') return 'result-attention';
                if (zip.ead_result === 'Fail') return 'result-fail';
                return '';
              };
              
              return `
                <tr>
                  <td><strong>${zip.zipline_name}</strong></td>
                  <td>${zip.cable_type || 'N/A'}</td>
                  <td>${zip.cable_length || 'N/A'}</td>
                  <td class="${getCableResultClass()}">${zip.cable_result || 'N/A'}</td>
                  <td>${zip.braking_system || 'N/A'}</td>
                  <td class="${getBrakingResultClass()}">${zip.braking_result || 'N/A'}</td>
                  <td>${zip.ead_system || 'N/A'}</td>
                  <td class="${getEadResultClass()}">${zip.ead_result || 'N/A'}</td>
                  <td style="font-size: 9pt;">${zip.comments || '—'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards and industry best practices.
      </div>
      <div class="page-number">Page 3 of ${pageCount}</div>
    </div>
  </div>
  ` : `
  <!-- SEPARATE PAGES -->
  <!-- PAGE 3: OPERATING SYSTEMS -->
  ${systems.length > 0 ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <h2>Operating Systems</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        Each operating system has been inspected for structural integrity, hardware condition, and environmental factors.
      </p>
      <table>
        <thead>
          <tr>
            <th style="width: 25%;">System Name</th>
            <th style="width: 15%;">Name/ID</th>
            <th style="width: 15%;">Lifeline HDW</th>
            <th style="width: 15%;">Activity HDW</th>
            <th style="width: 30%;">Comments</th>
          </tr>
        </thead>
        <tbody>
          ${systems.map(sys => {
            let resultClass = 'result-pass';
            if (sys.result === 'Needs Attention' || sys.result === 'Pass with Provisions') resultClass = 'result-attention';
            if (sys.result === 'Fail') resultClass = 'result-fail';
            
            return `
              <tr>
                <td><strong>${sys.system_name}</strong></td>
                <td>${sys.name || 'N/A'}</td>
                <td class="${resultClass}">${sys.result}</td>
                <td class="${resultClass}">${sys.result}</td>
                <td style="font-size: 9pt;">${sys.comments || '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards and industry best practices.
      </div>
      <div class="page-number">Page 3 of ${pageCount}</div>
    </div>
  </div>
  ` : ''}

  <!-- PAGE: ZIPLINES -->
  ${ziplines.length > 0 ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <h2>Ziplines</h2>
      
      <div style="margin-bottom: 15px; font-size: 9.5pt; padding: 10px; background: #f8f9fa; border-left: 3px solid #1e40af;">
        <strong>Key Abbreviations:</strong><br>
        <strong>Cable Type:</strong> GAC = Galvanized Aircraft Cable, SS = Stainless Steel<br>
        <strong>Braking System:</strong> ZS = Zipstop, FB = Friction Brake, SB = Spring Brake, G = Gravity<br>
        <strong>EAD System:</strong> Energy Absorption Device
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 15%;">Zipline Name</th>
            <th style="width: 8%;">Cable Type</th>
            <th style="width: 8%;">Length (ft)</th>
            <th style="width: 10%;">Cable Result</th>
            <th style="width: 10%;">Braking System</th>
            <th style="width: 10%;">Braking Result</th>
            <th style="width: 8%;">EAD System</th>
            <th style="width: 10%;">EAD Result</th>
            <th style="width: 21%;">Comments</th>
          </tr>
        </thead>
        <tbody>
          ${ziplines.map(zip => {
            const getCableResultClass = () => {
              if (zip.cable_result === 'Pass') return 'result-pass';
              if (zip.cable_result === 'Needs Attention' || zip.cable_result === 'Pass with Provisions') return 'result-attention';
              if (zip.cable_result === 'Fail') return 'result-fail';
              return '';
            };

            const getBrakingResultClass = () => {
              if (zip.braking_result === 'Pass') return 'result-pass';
              if (zip.braking_result === 'Needs Attention' || zip.braking_result === 'Pass with Provisions') return 'result-attention';
              if (zip.braking_result === 'Fail') return 'result-fail';
              return '';
            };

            const getEadResultClass = () => {
              if (zip.ead_result === 'Pass') return 'result-pass';
              if (zip.ead_result === 'Needs Attention' || zip.ead_result === 'Pass with Provisions') return 'result-attention';
              if (zip.ead_result === 'Fail') return 'result-fail';
              return '';
            };
            
            return `
              <tr>
                <td><strong>${zip.zipline_name}</strong></td>
                <td>${zip.cable_type || 'N/A'}</td>
                <td>${zip.cable_length || 'N/A'}</td>
                <td class="${getCableResultClass()}">${zip.cable_result || 'N/A'}</td>
                <td>${zip.braking_system || 'N/A'}</td>
                <td class="${getBrakingResultClass()}">${zip.braking_result || 'N/A'}</td>
                <td>${zip.ead_system || 'N/A'}</td>
                <td class="${getEadResultClass()}">${zip.ead_result || 'N/A'}</td>
                <td style="font-size: 9pt;">${zip.comments || '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards and industry best practices.
      </div>
      <div class="page-number">Page ${systems.length > 0 ? '4' : '3'} of ${pageCount}</div>
    </div>
  </div>
  ` : ''}
  `}

  <!-- PAGE: EQUIPMENT & ACCT STANDARDS (COMBINED OR SEPARATE) -->
  ${canCombineEquipmentStandards ? `
  <!-- COMBINED EQUIPMENT & STANDARDS PAGE -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <!-- Equipment Section -->
      <div class="combined-section">
        <h2>Equipment Inspection</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          All equipment has been inspected in accordance with manufacturer specifications and ACCT standards.
        </p>
        
        ${['Harnesses', 'Helmets', 'Lanyards', 'Carabiners', 'Rope', 'Belay Devices', 'Pulleys', 'Other'].map(category => {
          const categoryEquipment = equipment.filter(eq => 
            eq.equipment_category === category || 
            (category === 'Carabiners' && eq.equipment_category === 'Carabiners')
          );
          if (categoryEquipment.length === 0) return '';
          
          const categoryTitle = category === 'Carabiners' ? 'CONNECTORS (CARABINERS & QUICKLINKS)' : 
                               category === 'Rope' ? 'KERNMANTLE ROPE' :
                               category === 'Belay Devices' ? 'BELAY/DESCENT DEVICES' :
                               category === 'Pulleys' ? 'TROLLEYS AND PULLEYS' :
                               category === 'Other' ? 'OTHER EQUIPMENT' :
                               category.toUpperCase();
          
          return `
            <h3 style="margin-top: 15px; color: #1e40af; font-size: 12pt;">EQUIPMENT - ${categoryTitle}</h3>
            <table>
              <thead>
                <tr>
                  <th style="width: 35%;">Type</th>
                  <th style="width: 10%;">Quantity</th>
                  <th style="width: 12%;">Year</th>
                  <th style="width: 15%;">Result</th>
                  <th style="width: 28%;">Comments</th>
                </tr>
              </thead>
              <tbody>
                ${categoryEquipment.map(eq => {
                  let resultClass = 'result-pass';
                  if (eq.result === 'Needs Attention' || eq.result === 'Pass with Provisions') resultClass = 'result-attention';
                  if (eq.result === 'Fail') resultClass = 'result-fail';
                  
                  return `
                    <tr>
                      <td>${eq.equipment_type}</td>
                      <td style="text-align: center;">${eq.quantity || 'N/A'}</td>
                      <td style="text-align: center;">${eq.production_year || 'N/A'}</td>
                      <td class="${resultClass}">${eq.result}</td>
                      <td style="font-size: 9pt;">${eq.comments || '—'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `;
        }).join('')}
      </div>

      <div class="section-divider"></div>

      <!-- Standards Section -->
      <div class="combined-section">
        <h2>ACCT Operations Standards</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          Documentation verification as required by ACCT (Association for Challenge Course Technology) Standards. 
          The presence of documentation does not constitute review or approval of content.
        </p>

        <table>
          <thead>
            <tr>
              <th style="width: 65%;">Standard / Document</th>
              <th style="width: 10%; text-align: center;">Yes</th>
              <th style="width: 10%; text-align: center;">No</th>
              <th style="width: 15%; text-align: center;">Comments</th>
            </tr>
          </thead>
          <tbody>
            ${standards.map(std => `
              <tr>
                <td><strong>${std.standard_name}</strong></td>
                <td style="text-align: center; font-size: 16pt; color: #16a34a;">${std.has_documentation ? '✓' : ''}</td>
                <td style="text-align: center; font-size: 16pt; color: #dc2626;">${!std.has_documentation ? '✓' : ''}</td>
                <td style="font-size: 9pt; text-align: center;">${std.comments ? '✓' : '—'}</td>
              </tr>
              ${std.comments ? `
              <tr>
                <td colspan="4" style="font-size: 9pt; font-style: italic; background: #f9f9f9; padding-left: 20px;">
                  <strong>Comment:</strong> ${std.comments}
                </td>
              </tr>
              ` : ''}
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards and industry best practices.
      </div>
      <div class="page-number">Page ${pageCount - 1} of ${pageCount}</div>
    </div>
  </div>
  ` : `
  <!-- SEPARATE PAGES -->
  <!-- PAGE: EQUIPMENT -->
  ${equipment.length > 0 ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <h2>Equipment Inspection</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        All equipment has been inspected in accordance with manufacturer specifications and ACCT standards.
      </p>
      
      ${['Harnesses', 'Helmets', 'Lanyards', 'Carabiners', 'Rope', 'Belay Devices', 'Pulleys', 'Other'].map(category => {
        const categoryEquipment = equipment.filter(eq => 
          eq.equipment_category === category || 
          (category === 'Carabiners' && eq.equipment_category === 'Carabiners')
        );
        if (categoryEquipment.length === 0) return '';
        
        const categoryTitle = category === 'Carabiners' ? 'CONNECTORS (CARABINERS & QUICKLINKS)' : 
                             category === 'Rope' ? 'KERNMANTLE ROPE' :
                             category === 'Belay Devices' ? 'BELAY/DESCENT DEVICES' :
                             category === 'Pulleys' ? 'TROLLEYS AND PULLEYS' :
                             category === 'Other' ? 'OTHER EQUIPMENT' :
                             category.toUpperCase();
        
        return `
          <h3 style="margin-top: 20px; color: #1e40af; font-size: 12pt;">EQUIPMENT - ${categoryTitle}</h3>
          <table>
            <thead>
              <tr>
                <th style="width: 35%;">Type</th>
                <th style="width: 10%;">Quantity</th>
                <th style="width: 12%;">Year</th>
                <th style="width: 15%;">Result</th>
                <th style="width: 28%;">Comments</th>
              </tr>
            </thead>
            <tbody>
              ${categoryEquipment.map(eq => {
                let resultClass = 'result-pass';
                if (eq.result === 'Needs Attention' || eq.result === 'Pass with Provisions') resultClass = 'result-attention';
                if (eq.result === 'Fail') resultClass = 'result-fail';
                
                return `
                  <tr>
                    <td>${eq.equipment_type}</td>
                    <td style="text-align: center;">${eq.quantity || 'N/A'}</td>
                    <td style="text-align: center;">${eq.production_year || 'N/A'}</td>
                    <td class="${resultClass}">${eq.result}</td>
                    <td style="font-size: 9pt;">${eq.comments || '—'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
      }).join('')}
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards and industry best practices.
      </div>
      <div class="page-number">Page ${systems.length > 0 ? (ziplines.length > 0 ? '5' : '4') : (ziplines.length > 0 ? '4' : '3')} of ${pageCount}</div>
    </div>
  </div>
  ` : ''}

  <!-- PAGE: ACCT STANDARDS -->
  ${standards.length > 0 ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <h2>ACCT Operations Standards</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        Documentation verification as required by ACCT (Association for Challenge Course Technology) Standards. 
        The presence of documentation does not constitute review or approval of content.
      </p>

      <table>
        <thead>
          <tr>
            <th style="width: 65%;">Standard / Document</th>
            <th style="width: 10%; text-align: center;">Yes</th>
            <th style="width: 10%; text-align: center;">No</th>
            <th style="width: 15%; text-align: center;">Comments</th>
          </tr>
        </thead>
        <tbody>
          ${standards.map(std => `
            <tr>
              <td><strong>${std.standard_name}</strong></td>
              <td style="text-align: center; font-size: 16pt; color: #16a34a;">${std.has_documentation ? '✓' : ''}</td>
              <td style="text-align: center; font-size: 16pt; color: #dc2626;">${!std.has_documentation ? '✓' : ''}</td>
              <td style="font-size: 9pt; text-align: center;">${std.comments ? '✓' : '—'}</td>
            </tr>
            ${std.comments ? `
            <tr>
              <td colspan="4" style="font-size: 9pt; font-style: italic; background: #f9f9f9; padding-left: 20px;">
                <strong>Comment:</strong> ${std.comments}
              </td>
            </tr>
            ` : ''}
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards and industry best practices.
      </div>
      <div class="page-number">Page ${pageCount - 1} of ${pageCount}</div>
    </div>
  </div>
  ` : ''}
  `}

  <!-- PAGE: SUMMARY -->
  ${summary ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 10px; margin-bottom: 20px;">Inspection Summary</h2>

      ${summary.repairs_performed ? `
      <div style="margin-bottom: 25px;">
        <h3 style="font-size: 12pt; font-weight: bold; margin-bottom: 10px; color: #1a1a1a; border-bottom: 2px solid #16a34a; padding-bottom: 5px;">Repairs Performed</h3>
        <div class="text-block" style="padding: 10px 15px; background: #f9f9f9; border-left: 4px solid #16a34a;">
          ${deduplicateHtmlContent(summary.repairs_performed)}
        </div>
      </div>
      ` : ''}

      ${summary.critical_actions ? `
      <div class="critical-box" style="margin-bottom: 25px; padding: 15px; background: #fef2f2; border: 2px solid #dc2626; border-radius: 4px;">
        <h3 style="font-size: 12pt; font-weight: bold; margin-bottom: 10px; color: #dc2626; text-transform: uppercase;">⚠ Critical Actions Required</h3>
        <div style="font-size: 10pt; line-height: 1.6; color: #1a1a1a;">
          ${deduplicateHtmlContent(summary.critical_actions)}
        </div>
        <p style="margin-top: 10px; font-size: 9pt; font-style: italic; color: #7f1d1d;">
          <strong>IMPORTANT:</strong> Items listed above must be addressed immediately. Do not use affected equipment or systems until corrective actions are completed and verified by a qualified professional.
        </p>
      </div>
      ` : ''}

      ${summary.future_considerations ? `
      <div style="margin-bottom: 25px;">
        <h3 style="font-size: 12pt; font-weight: bold; margin-bottom: 10px; color: #1a1a1a; border-bottom: 2px solid #ea580c; padding-bottom: 5px;">Future Considerations</h3>
        <div class="text-block" style="padding: 10px 15px; background: #fff7ed; border-left: 4px solid #ea580c;">
          ${deduplicateHtmlContent(summary.future_considerations)}
        </div>
      </div>
      ` : ''}

      ${summary.next_inspection_date ? `
      <div style="margin-bottom: 25px; padding: 12px 15px; background: #f0f9ff; border-left: 4px solid #0284c7;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 5px; color: #0284c7;">Next Scheduled Inspection</h3>
        <p style="font-size: 11pt; margin: 0; color: #1a1a1a;"><strong>${formatDate(summary.next_inspection_date)}</strong></p>
        <p style="font-size: 9pt; margin-top: 5px; color: #666; font-style: italic;">Annual professional inspections are required to maintain ACCT compliance.</p>
      </div>
      ` : ''}

      <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e5e5;">
        <h3 style="font-size: 12pt; font-weight: bold; margin-bottom: 15px; color: #1a1a1a;">Equipment Retirement Guidelines</h3>
        
        <p style="font-size: 10pt; line-height: 1.6; margin-bottom: 12px; color: #1a1a1a;">
          <strong>Equipment must be retired from service when any of the following conditions are met:</strong>
        </p>
        
        <div style="padding: 10px 15px; background: #fafafa; border-left: 3px solid #666;">
          <ul style="margin: 8px 0; padding-left: 20px; font-size: 10pt; line-height: 1.8;">
            <li style="margin-bottom: 6px;">Manufacturer's recommended lifespan has been exceeded</li>
            <li style="margin-bottom: 6px;">Visible damage, wear, or deterioration affecting structural integrity</li>
            <li style="margin-bottom: 6px;">Equipment subjected to impact forces or shock loading beyond design parameters</li>
            <li style="margin-bottom: 6px;">Missing or illegible manufacturer identification markings</li>
            <li style="margin-bottom: 6px;">Equipment fails inspection criteria outlined in current ACCT standards</li>
            <li style="margin-bottom: 6px;">Incomplete or unavailable documentation of equipment history</li>
            <li style="margin-bottom: 0;">Equipment is involved in any incident resulting in injury or near-miss</li>
          </ul>
        </div>
        
        <div style="margin-top: 15px; padding: 12px; background: #fff7ed; border-left: 4px solid #ea580c;">
          <p style="font-size: 10pt; line-height: 1.6; margin: 0; color: #1a1a1a;">
            <strong>Retirement Procedure:</strong> All retired equipment must be clearly marked "RETIRED - DO NOT USE", immediately removed from service, and physically destroyed or rendered permanently unusable to prevent accidental future use. Complete documentation of the retirement, including date, reason, and method of disposal, must be maintained in accordance with ACCT record-keeping requirements.
          </p>
        </div>
      </div>
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        This report has been prepared by a Qualified Professional in accordance with ACCT standards. This report is effective for one year from the date of inspection.<br>
        <strong>For questions or clarifications, contact:</strong> Rope Works Inc. | PO Box 1074, Dripping Springs, TX 78620 | www.ropeworksinc.com
      </div>
      <div class="page-number">Page ${pageCount} of ${pageCount}</div>
    </div>
  </div>
  ` : ''}

</body>
</html>`;

    return new Response(
      JSON.stringify({ html }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error generating HTML:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});