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

    // Calculate page count
    let pageCount = 2; // Cover + Key
    if (systems.length > 0) pageCount++;
    if (ziplines.length > 0) pageCount++;
    if (equipment.length > 0) pageCount++;
    if (standards.length > 0) pageCount++;
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
      position: relative;
      min-height: 100vh;
      padding: 0.5in;
      page-break-after: always;
    }

    .page:last-child {
      page-break-after: avoid;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 3px solid #1e40af;
      margin-bottom: 20px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-left img {
      height: 70px;
      width: auto;
    }

    .header-title {
      font-size: 11pt;
      font-weight: bold;
      color: #1e40af;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .header-right img {
      height: 60px;
      width: auto;
    }

    .page-footer {
      position: absolute;
      bottom: 0.3in;
      left: 0.5in;
      right: 0.5in;
      font-size: 9pt;
      color: #666;
      border-top: 1px solid #ddd;
      padding-top: 10px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .page-number {
      font-weight: bold;
      white-space: nowrap;
    }

    h1 {
      font-size: 24pt;
      color: #1e40af;
      margin-bottom: 20px;
      font-weight: bold;
      line-height: 1.3;
    }

    h2 {
      font-size: 16pt;
      color: #1e40af;
      margin: 20px 0 12px 0;
      font-weight: bold;
      line-height: 1.4;
    }

    h3 {
      font-size: 13pt;
      color: #000;
      margin: 15px 0 10px 0;
      font-weight: bold;
      line-height: 1.3;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      margin: 20px 0;
      border: 1px solid #ddd;
    }

    .info-cell {
      padding: 10px 12px;
      border-right: 1px solid #ddd;
      border-bottom: 1px solid #ddd;
    }

    .info-cell:nth-child(2n) {
      border-right: none;
    }

    .info-label {
      font-weight: bold;
      font-size: 9.5pt;
      margin-bottom: 4px;
      color: #333;
    }

    .info-value {
      font-size: 11pt;
      color: #000;
      line-height: 1.4;
    }

    .text-block {
      margin: 15px 0;
      padding: 15px 18px;
      background: #f9f9f9;
      border-left: 4px solid #1e40af;
      font-size: 10pt;
      line-height: 1.7;
    }

    .bullet-list {
      margin: 10px 0 10px 30px;
      font-size: 10pt;
    }

    .bullet-list li {
      margin-bottom: 10px;
      line-height: 1.6;
      padding-left: 5px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      font-size: 10pt;
    }

    table th {
      background: #1e40af;
      color: #fff;
      padding: 10px;
      text-align: left;
      font-weight: bold;
      border: 1px solid #1e40af;
      font-size: 10pt;
    }

    table td {
      padding: 10px;
      border: 1px solid #ddd;
      vertical-align: top;
      line-height: 1.5;
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
      margin: 15px 0;
      padding: 15px 18px;
      background: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 2px;
    }

    .key-section h3 {
      margin-top: 0;
      margin-bottom: 8px;
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
      padding: 18px;
      margin: 15px 0;
      border-radius: 2px;
    }

    .critical-box h3 {
      color: #dc2626;
      margin-top: 0;
      margin-bottom: 10px;
    }

    @media print {
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }

      .page {
        page-break-after: always;
        page-break-inside: avoid;
      }
      
      .page:last-child {
        page-break-after: avoid;
      }

      table {
        page-break-inside: avoid;
      }

      h2, h3 {
        page-break-after: avoid;
      }

      @page {
        margin: 0.5in;
        size: letter;
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>
    <div class="header-title" style="text-align: center; margin-bottom: 20px;">ROPES/CHALLENGE COURSE</div>

    <h1 style="text-align: center;">Professional Inspection for Aerial Adventure Programs</h1>

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
      <div class="info-cell"></div>
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
      <div class="info-cell"></div>
      ${inspection.previous_inspector ? `
      <div class="info-cell">
        <div class="info-label">Previously Inspected by:</div>
        <div class="info-value">${inspection.previous_inspector}</div>
      </div>
      <div class="info-cell">
        <div class="info-label">Inspector:</div>
        <div class="info-value">Previous Inspector</div>
      </div>
      <div class="info-cell">
        <div class="info-label">Prev. Inspection Date:</div>
        <div class="info-value">${formatDate(inspection.previous_inspection_date)}</div>
      </div>
      <div class="info-cell"></div>
      ` : ''}
    </div>

    ${inspection.course_history ? `
    <h2>Known Course History</h2>
    <div class="text-block">${inspection.course_history}</div>
    ` : `
    <h2>Known Course History</h2>
    <div class="text-block">
      This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. 
      The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. 
      The inspection does not include training on how to operate the equipment, nor how to operate the course. 
      The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), 
      and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. 
      Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible 
      for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend 
      you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional 
      inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology 
      ANSI/ACCT current published standards.
    </div>
    `}

    <h2>Reminders and Requirements</h2>
    <ul class="bullet-list">
      <li>Employers are required to issue staff appropriate fall protection for the duties to be performed.</li>
      <li>A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.</li>
      <li>Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.</li>
      <li>Proper staff training should be provided for the operation of all aerial activities and equipment on your site.</li>
      <li>Operational Reviews shall be conducted once every five years.</li>
    </ul>

    <div class="page-footer">
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection.<br>
        Issued by: Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620
      </div>
      <div class="page-number">Page 1 of ${pageCount}</div>
    </div>
  </div>

  <!-- PAGE 2: INSPECTION KEY -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <p style="margin-bottom: 15px; font-size: 10pt;">All inspections include the following when applicable:</p>

    <div class="key-section">
      <h3>Lifeline HDW</h3>
      <p>Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, & redundant terminations.</p>
    </div>

    <div class="key-section">
      <h3>Activity HDW</h3>
      <p>Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, etc.</p>
    </div>

    <div class="key-section">
      <h3>Environment</h3>
      <p>This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, trees, rocks, & terrain.</p>
    </div>

    <div class="key-section">
      <h3>Equipment</h3>
      <p>This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, etc.</p>
    </div>

    <h2 style="margin-top: 25px;">Pass/Pass with Provisions/Fail</h2>
    <p style="margin-bottom: 15px; font-size: 10pt;">
      This represents the overall rating for the system based on the condition of the items inspected on the day of the inspection. 
      Rope Works Inc. inspects all challenge course and canopy/zip line tours to the standards set forth by the ACCT. 
      Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the Comment section.
    </p>

    <h2>Inspection Key</h2>
    <ul class="bullet-list">
      <li><strong>Pass</strong> - The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection. No corrective actions are necessary. The item is approved for continued use until the next scheduled inspection.</li>
      <li><strong>Pass with Provisions</strong> - The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern. The item may remain in service under specified conditions or with specific limitations until the required actions are completed. A timeline for resolution should be established.</li>
      <li><strong>Fail</strong> - The equipment or operating system does not meet minimum safety standards and poses a risk to participants or staff. Immediate corrective action is required. The item must be removed from service until all necessary repairs, replacements, or modifications are completed and verified by a qualified professional.</li>
      <li><strong>N/A (Not Applicable)</strong> - The inspection criterion does not apply to this particular system, element, or piece of equipment at this time.</li>
    </ul>

    <div class="page-footer">
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.
      </div>
      <div class="page-number">Page 2 of ${pageCount}</div>
    </div>
  </div>

  <!-- PAGE 3: OPERATING SYSTEMS -->
  ${systems.length > 0 ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <h2>Operating Systems</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 25%;">System Name</th>
          <th style="width: 20%;">Name/ID</th>
          <th style="width: 15%;">Lifeline HDW</th>
          <th style="width: 15%;">Activity HDW</th>
          <th style="width: 25%;">Comments</th>
        </tr>
      </thead>
      <tbody>
        ${systems.map(sys => {
          let resultClass = 'result-pass';
          if (sys.result === 'Needs Attention') resultClass = 'result-attention';
          if (sys.result === 'Fail') resultClass = 'result-fail';
          
          return `
            <tr>
              <td>${sys.system_name}</td>
              <td>${sys.name || 'N/A'}</td>
              <td class="${resultClass}">${sys.result}</td>
              <td class="${resultClass}">${sys.result}</td>
              <td style="font-size: 9pt;">${sys.comments || ''}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>

    <div class="page-footer">
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.
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
        <img src="${acctLogo}" alt="ACCT">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <h2>Ziplines</h2>
    
    <div style="margin-bottom: 15px; font-size: 9pt;">
      <strong>Cable Type:</strong> GAC = Galvanized Aircraft Cable, SS = Stainless Steel<br>
      <strong>Braking System:</strong> ZS = Zipstop, FB = Friction Brake, SB = Spring Brake, G = Gravity<br>
      <strong>EAD System:</strong> Energy Absorption Device
    </div>

    <table>
      <thead>
        <tr>
          <th>Zipline Name</th>
          <th>Cable Type</th>
          <th>Length (ft)</th>
          <th>Cable Result</th>
          <th>Braking System</th>
          <th>Braking Result</th>
          <th>EAD System</th>
          <th>EAD Result</th>
          <th>Comments</th>
        </tr>
      </thead>
      <tbody>
        ${ziplines.map(zip => {
          const getCableResultClass = () => {
            if (zip.cable_result === 'Pass') return 'result-pass';
            if (zip.cable_result === 'Needs Attention') return 'result-attention';
            if (zip.cable_result === 'Fail') return 'result-fail';
            return '';
          };

          const getBrakingResultClass = () => {
            if (zip.braking_result === 'Pass') return 'result-pass';
            if (zip.braking_result === 'Needs Attention') return 'result-attention';
            if (zip.braking_result === 'Fail') return 'result-fail';
            return '';
          };

          const getEadResultClass = () => {
            if (zip.ead_result === 'Pass') return 'result-pass';
            if (zip.ead_result === 'Needs Attention') return 'result-attention';
            if (zip.ead_result === 'Fail') return 'result-fail';
            return '';
          };
          
          return `
            <tr>
              <td>${zip.zipline_name}</td>
              <td>${zip.cable_type || 'N/A'}</td>
              <td>${zip.cable_length || 'N/A'}</td>
              <td class="${getCableResultClass()}">${zip.cable_result || 'N/A'}</td>
              <td>${zip.braking_system || 'N/A'}</td>
              <td class="${getBrakingResultClass()}">${zip.braking_result || 'N/A'}</td>
              <td>${zip.ead_system || 'N/A'}</td>
              <td class="${getEadResultClass()}">${zip.ead_result || 'N/A'}</td>
              <td style="font-size: 9pt;">${zip.comments || ''}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>

    <div class="page-footer">
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.
      </div>
      <div class="page-number">Page ${systems.length > 0 ? '4' : '3'} of ${pageCount}</div>
    </div>
  </div>
  ` : ''}

  <!-- PAGE: EQUIPMENT -->
  ${equipment.length > 0 ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <h2>Equipment</h2>
    
    ${['Rope', 'Carabiners', 'Helmets', 'Belay Devices', 'Pulleys', 'Harnesses', 'Other'].map(category => {
      const categoryEquipment = equipment.filter(eq => eq.equipment_category === category);
      if (categoryEquipment.length === 0) return '';
      
      return `
        <h3>${category}</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 30%;">Type</th>
              <th style="width: 10%;">Qty</th>
              <th style="width: 10%;">Year</th>
              <th style="width: 15%;">Result</th>
              <th style="width: 35%;">Comments</th>
            </tr>
          </thead>
          <tbody>
            ${categoryEquipment.map(eq => {
              let resultClass = 'result-pass';
              if (eq.result === 'Needs Attention') resultClass = 'result-attention';
              if (eq.result === 'Fail') resultClass = 'result-fail';
              
              return `
                <tr>
                  <td>${eq.equipment_type}</td>
                  <td>${eq.quantity || 'N/A'}</td>
                  <td>${eq.production_year || 'N/A'}</td>
                  <td class="${resultClass}">${eq.result}</td>
                  <td style="font-size: 9pt;">${eq.comments || ''}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }).join('')}

    <div class="page-footer">
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.
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
        <img src="${acctLogo}" alt="ACCT">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <h2>ACCT Operations Standards</h2>
    <p style="margin-bottom: 15px; font-size: 10pt;">Documentation verification as required by ACCT Standards:</p>

    <table>
      <thead>
        <tr>
          <th style="width: 70%;">Standard / Document</th>
          <th style="width: 10%;">Yes</th>
          <th style="width: 10%;">No</th>
          <th style="width: 10%;">N/A</th>
        </tr>
      </thead>
      <tbody>
        ${standards.map(std => `
          <tr>
            <td>${std.standard_name}</td>
            <td style="text-align: center;">${std.has_documentation ? '✓' : ''}</td>
            <td style="text-align: center;">${!std.has_documentation ? '✓' : ''}</td>
            <td style="text-align: center;"></td>
          </tr>
          ${std.comments ? `
          <tr>
            <td colspan="4" style="font-size: 9pt; font-style: italic; background: #f9f9f9;">
              Comments: ${std.comments}
            </td>
          </tr>
          ` : ''}
        `).join('')}
      </tbody>
    </table>

    <div class="page-footer">
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.
      </div>
      <div class="page-number">Page ${pageCount - 1} of ${pageCount}</div>
    </div>
  </div>
  ` : ''}

  <!-- PAGE: SUMMARY -->
  ${summary ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${acctLogo}" alt="ACCT">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
    </div>

    <h2>Inspection Summary</h2>

    ${summary.repairs_performed ? `
    <h3>Repairs Performed</h3>
    <div class="text-block">${deduplicateHtmlContent(summary.repairs_performed)}</div>
    ` : ''}

    ${summary.critical_actions ? `
    <div class="critical-box">
      <h3>Critical Actions Required</h3>
      <div>${deduplicateHtmlContent(summary.critical_actions)}</div>
    </div>
    ` : ''}

    ${summary.future_considerations ? `
    <h3>Future Considerations</h3>
    <div class="text-block">${deduplicateHtmlContent(summary.future_considerations)}</div>
    ` : ''}

    ${summary.next_inspection_date ? `
    <h3>Next Inspection Date</h3>
    <div class="text-block"><strong>${formatDate(summary.next_inspection_date)}</strong></div>
    ` : ''}

    <h3 style="margin-top: 25px;">Retirement Guidelines</h3>
    <div class="text-block">
      <strong>Equipment Retirement Criteria:</strong><br><br>
      Equipment should be retired from service when any of the following conditions are met:
      <ul style="margin: 10px 0 10px 20px;">
        <li>Manufacturer's recommended lifespan has been exceeded</li>
        <li>Visible damage, wear, or deterioration that affects structural integrity</li>
        <li>Equipment has been subjected to impact forces or shock loading</li>
        <li>Missing or illegible manufacturer identification markings</li>
        <li>Equipment fails inspection criteria as outlined in ACCT standards</li>
        <li>Documentation of equipment history is incomplete or unavailable</li>
      </ul>
      <br>
      All retired equipment must be clearly marked, removed from service, and destroyed or rendered unusable to prevent future use. 
      Proper documentation of retirement must be maintained for record-keeping purposes.
    </div>

    <div class="page-footer">
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection.
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