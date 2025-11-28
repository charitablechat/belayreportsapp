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
  
  // Extract and deduplicate list items
  while ((match = listItemRegex.exec(html)) !== null) {
    const content = match[1].trim();
    const contentLower = content.toLowerCase();
    
    // Normalize content for better matching (remove extra spaces, punctuation differences)
    const normalizedContent = contentLower
      .replace(/[.,;:!?]+$/, '') // Remove trailing punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    // Skip empty items
    if (!content || !normalizedContent) continue;
    
    // Check for semantic duplicates (items that say the same thing)
    let isDuplicate = false;
    for (const [existingKey] of uniqueItems) {
      const normalizedExisting = existingKey
        .replace(/[.,;:!?]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Check if this item is essentially the same as an existing one
      if (normalizedContent === normalizedExisting || 
          normalizedContent.includes(normalizedExisting) ||
          normalizedExisting.includes(normalizedContent)) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      uniqueItems.set(contentLower, content);
    }
  }
  
  // If we found list items, return optimized list
  if (uniqueItems.size > 0) {
    const items = Array.from(uniqueItems.values()).map(item => `<li>${item}</li>`).join('\n');
    return `<ul class="bullet-list">\n${items}\n</ul>`;
  }
  
  // Handle non-list content: deduplicate lines
  const lines = html.split('\n').map(l => l.trim()).filter(Boolean);
  const uniqueLines = new Map<string, string>();
  
  lines.forEach(line => {
    const lineLower = line.toLowerCase()
      .replace(/[.,;:!?]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (lineLower && !uniqueLines.has(lineLower)) {
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

    // Helper function to format result as checkbox with conditional highlighting
    const formatResultCheckbox = (result: string): { html: string; cellStyle: string } => {
      const pass = result === 'Pass' ? '☑' : '☐';
      const provisions = (result === 'Pass with Provisions' || result === 'Needs Attention') ? '☑' : '☐';
      const fail = result === 'Fail' ? '☑' : '☐';
      
      let cellStyle = '';
      if (result === 'Fail') {
        cellStyle = 'background-color: #ff6b6b;'; // Red highlight for Fail
      } else if (result === 'Pass with Provisions' || result === 'Needs Attention') {
        cellStyle = 'background-color: #ffff00;'; // Yellow highlight for Pass w/Provisions
      }
      
      return {
        html: `<span class="result-checkbox">${pass} Pass  ${provisions} Pass w/ Provisions  ${fail} Fail</span>`,
        cellStyle
      };
    };

    const inspectorName = inspection.profiles
      ? `${inspection.profiles.first_name || ""} ${inspection.profiles.last_name || ""}`.trim() || "Unknown"
      : "Unknown";
    const acctNumber = inspection.profiles?.acct_number || inspection.acct_number || "N/A";

    // Content volume calculation for page consolidation
    // WHITESPACE REDUCTION SYSTEM (Phases 1-7):
    // Phase 1: Flow-based layout with flexbox (removed fixed heights)
    // Phase 2: Dynamic spacing with CSS variables (30-40% reduction)
    // Phase 3: Smart page consolidation based on content volume
    // Phase 4: Print-optimized margins and typography (0.35in margins, 9-15pt fonts)
    // Phase 5: Optimized table column widths to prevent wrapping
    // Phase 6: Enhanced bullet deduplication and tighter list spacing
    // Phase 7: Layout validation with min-heights, overflow handling, orphan/widow controls
    
    const COMBINE_THRESHOLD = 4; // Maximum rows to consider for combining pages
    const systemsRowCount = systems.length;
    const ziplinesRowCount = ziplines.length;
    const equipmentRowCount = equipment.length;
    const standardsRowCount = standards.length;
    
    // Determine which pages can be combined (Phase 3)
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
      margin: 0.35in 0.45in;
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
      min-height: 200px; /* Prevent collapsed pages */
    }

    .page:last-child {
      page-break-after: avoid;
    }

    /* Content validation safeguards */
    .page-content > *:first-child {
      margin-top: 0;
    }

    .page-content > *:last-child {
      margin-bottom: 0;
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
      border-top: 1px solid #000;
      padding-top: 8px;
      padding-right: 80px;
    }

    .disclaimer {
      text-align: center;
      line-height: 1.4;
      font-size: 8.5pt;
      margin: 0 auto;
    }

    .page-number {
      position: absolute;
      right: 0;
      bottom: 8px;
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
      color: #fff;
      background: #1B6DB5;
      margin: 12px 0 8px 0;
      padding: 6px 10px;
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
      gap: 18px 30px;
      margin: 25px 0;
      border: none;
    }

    .info-cell {
      padding: 0;
      border: none;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .info-cell:nth-child(2n) {
      border-right: none;
    }

    .info-label {
      font-weight: 600;
      font-size: 10pt;
      color: #000;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .info-value {
      flex: 1;
      font-size: 10pt;
      color: #000;
      line-height: 1.4;
      border-bottom: 1px dotted #666;
      min-height: 18px;
      padding-bottom: 2px;
    }

    .text-block {
      margin: 10px 0;
      padding: 10px 14px;
      background: transparent;
      border: 1px solid #000;
      font-size: 10pt;
      line-height: 1.7;
      min-height: 40px; /* Prevent collapsed text blocks */
      overflow-wrap: break-word;
      word-break: break-word;
    }

    /* Prevent orphaned content */
    .text-block, .key-section, .critical-box {
      orphans: 3;
      widows: 3;
    }

    .bullet-list {
      margin: 8px 0 8px 20px;
      font-size: 10pt;
      padding-left: 5px;
    }

    .bullet-list li {
      margin-bottom: 5px;
      line-height: 1.5;
      padding-left: 3px;
    }

    .bullet-list li:last-child {
      margin-bottom: 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 9.5pt;
    }

    table th {
      background: #e5e7eb;
      color: #000;
      padding: 6px 8px;
      text-align: left;
      font-weight: bold;
      border: 1px solid #000;
      font-size: 10pt;
    }

    table td {
      padding: 6px 8px;
      border: 1px solid #000;
      vertical-align: top;
      line-height: 1.4;
      max-width: 400px; /* Prevent excessive cell expansion */
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    table tr:nth-child(even) {
      background: transparent;
    }

    /* Prevent table overflow */
    table {
      table-layout: auto;
      overflow-wrap: break-word;
    }

    /* Handle empty table cells gracefully */
    table td:empty::after {
      content: '—';
      color: #999;
    }

    .result-checkbox {
      font-size: 9pt;
      white-space: nowrap;
      color: #000;
      font-weight: normal;
    }

    /* Optimized column widths for Equipment table */
    .equipment-table th:nth-child(1),
    .equipment-table td:nth-child(1) { width: 35%; } /* Type */
    .equipment-table th:nth-child(2),
    .equipment-table td:nth-child(2) { width: 12%; } /* Quantity */
    .equipment-table th:nth-child(3),
    .equipment-table td:nth-child(3) { width: 10%; } /* Year */
    .equipment-table th:nth-child(4),
    .equipment-table td:nth-child(4) { width: 20%; } /* Result - wider for checkboxes */
    .equipment-table th:nth-child(5),
    .equipment-table td:nth-child(5) { width: 23%; } /* Comments */

    /* Optimized column widths for Standards table */
    .standards-table th:nth-child(1),
    .standards-table td:nth-child(1) { width: 50%; } /* Standard Name */
    .standards-table th:nth-child(2),
    .standards-table td:nth-child(2) { width: 15%; } /* Yes */
    .standards-table th:nth-child(3),
    .standards-table td:nth-child(3) { width: 15%; } /* No */
    .standards-table th:nth-child(4),
    .standards-table td:nth-child(4) { width: 20%; } /* Comments */

    /* Optimized column widths for Ziplines table (9 columns) */
    .ziplines-table th:nth-child(1),
    .ziplines-table td:nth-child(1) { width: 13%; } /* Name */
    .ziplines-table th:nth-child(2),
    .ziplines-table td:nth-child(2) { width: 9%; } /* Cable Type */
    .ziplines-table th:nth-child(3),
    .ziplines-table td:nth-child(3) { width: 8%; } /* Length */
    .ziplines-table th:nth-child(4),
    .ziplines-table td:nth-child(4) { width: 10%; } /* Cable Result */
    .ziplines-table th:nth-child(5),
    .ziplines-table td:nth-child(5) { width: 11%; } /* Braking System */
    .ziplines-table th:nth-child(6),
    .ziplines-table td:nth-child(6) { width: 10%; } /* Braking Result */
    .ziplines-table th:nth-child(7),
    .ziplines-table td:nth-child(7) { width: 9%; } /* EAD System */
    .ziplines-table th:nth-child(8),
    .ziplines-table td:nth-child(8) { width: 10%; } /* EAD Result */
    .ziplines-table th:nth-child(9),
    .ziplines-table td:nth-child(9) { width: 20%; } /* Comments */

    /* Optimized column widths for Operating Systems table */
    .systems-table th:nth-child(1),
    .systems-table td:nth-child(1) { width: 20%; } /* System Type */
    .systems-table th:nth-child(2),
    .systems-table td:nth-child(2) { width: 20%; } /* Name */
    .systems-table th:nth-child(3),
    .systems-table td:nth-child(3) { width: 12%; } /* Result */
    .systems-table th:nth-child(4),
    .systems-table td:nth-child(4) { width: 48%; } /* Comments */

    /* Optimized column widths for Standards table */
    .standards-table th:nth-child(1),
    .standards-table td:nth-child(1) { width: 35%; } /* Standard */
    .standards-table th:nth-child(2),
    .standards-table td:nth-child(2) { width: 15%; } /* Documentation */
    .standards-table th:nth-child(3),
    .standards-table td:nth-child(3) { width: 50%; } /* Comments */

    /* Prevent column content wrapping where appropriate */
    .equipment-table td:nth-child(2),
    .equipment-table td:nth-child(3),
    .equipment-table td:nth-child(4),
    .ziplines-table td:nth-child(3),
    .ziplines-table td:nth-child(4),
    .ziplines-table td:nth-child(6),
    .ziplines-table td:nth-child(8),
    .systems-table td:nth-child(3),
    .standards-table td:nth-child(2),
    .standards-table td:nth-child(3) {
      white-space: nowrap;
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
      min-height: 100px; /* Prevent collapsed combined sections */
      page-break-inside: avoid;
    }

    .combined-section:last-child {
      margin-bottom: 0;
    }

    .section-divider {
      border-top: 2px solid #e5e7eb;
      margin: 20px 0;
      page-break-after: avoid; /* Keep divider with following content */
      min-height: 2px;
    }

    /* Ensure headers don't orphan after dividers */
    .section-divider + h2,
    .section-divider + h3,
    .section-divider + .combined-section {
      page-break-before: avoid;
    }

    @media print {
      /* Force accurate color reproduction */
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
        background: white;
        color: black;
        font-size: 10pt;
        line-height: 1.4;
      }

      /* Page setup and margins */
      @page {
        size: letter portrait;
        margin: 0.5in;
      }

      /* Page break controls with validation */
      .page {
        display: flex;
        flex-direction: column;
        page-break-after: always;
        page-break-inside: avoid;
        min-height: auto;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      .page-content {
        flex: 1 0 auto;
        min-height: 3in; /* Ensure minimum content area for print */
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
        orphans: 2;
        widows: 2;
      }

      /* Table break handling with overflow protection */
      table {
        page-break-inside: avoid;
        width: 100%;
        max-width: 100%;
        overflow-x: auto;
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

      td, th {
        max-width: 400px;
        overflow-wrap: break-word;
        word-wrap: break-word;
        hyphens: auto;
      }

      /* Prevent excessive cell width from breaking layout */
      .equipment-table td:nth-child(1),
      .systems-table td:nth-child(1),
      .ziplines-table td:nth-child(1) {
        max-width: 200px;
      }

      .equipment-table td:nth-child(5),
      .systems-table td:nth-child(4),
      .ziplines-table td:nth-child(9),
      .standards-table td:nth-child(3) {
        max-width: 300px; /* Limit comments column */
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

      /* Footer positioning for print with validation */
      .page-footer {
        position: relative;
        margin-top: auto;
        page-break-inside: avoid;
        padding-top: 8px;
        min-height: 30px; /* Ensure footer space */
      }

      /* Phase 1: Print Layout Fix - Replace Flexbox with Block */
      @media print {
        /* Phase 3: Page Margin Harmonization */
        .page {
          display: block !important;
          position: relative;
          min-height: 100vh;
          padding: 0 !important;
          margin: 0 !important;
          box-sizing: border-box;
        }
        
        .page-content {
          display: block;
          min-height: calc(100vh - 2in);
        }
        
        .page-footer {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
        }
        
        /* Phase 2: Print Color Enforcement */
        *, *::before, *::after {
          print-color-adjust: exact !important;
          -webkit-print-color-adjust: exact !important;
        }
        
        /* Specific element color enforcement */
        table th, 
        table tr:nth-child(even), 
        .key-section, 
        .critical-box, 
        .text-block, 
        .info-grid, 
        .info-cell,
        .result-pass,
        .result-attention,
        .result-fail {
          print-color-adjust: exact !important;
          -webkit-print-color-adjust: exact !important;
        }
        
        /* Phase 4: Print Resets - Remove Visual Artifacts */
        /* Hide link URLs that browsers add by default */
        a[href]::after {
          content: none !important;
        }
        
        /* Remove shadows and transforms that can cause rendering issues */
        * {
          box-shadow: none !important;
          text-shadow: none !important;
          transform: none !important;
        }
        
        /* Normalize zoom and ensure consistent rendering */
        body {
          zoom: 1 !important;
          -webkit-transform: scale(1) !important;
          transform: scale(1) !important;
        }
        
        /* Remove any animations or transitions */
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
        }
        
        /* Phase 5: Image Handling Optimization */
        /* Constrain image sizes while preserving quality */
        img {
          max-width: 100% !important;
          max-height: 400px !important;
          height: auto !important;
          page-break-inside: avoid !important;
          object-fit: contain !important;
        }
        
        /* Ensure crisp image rendering */
        img {
          image-rendering: -webkit-optimize-contrast !important;
          image-rendering: crisp-edges !important;
          -ms-interpolation-mode: nearest-neighbor !important;
        }
        
        /* Logo-specific constraints */
        .logo-container img,
        .header-logo img {
          max-height: 80px !important;
          width: auto !important;
        }
        
        /* Photo gallery images */
        .photo-grid img,
        .photo-item img {
          max-width: 100% !important;
          max-height: 300px !important;
          display: block !important;
          margin: 0 auto !important;
        }
        
        /* Phase 6: Table Print Optimization */
        /* Prevent table breaks inside rows */
        table {
          page-break-inside: auto !important;
          border-collapse: collapse !important;
          width: 100% !important;
        }
        
        tr {
          page-break-inside: avoid !important;
          page-break-after: auto !important;
        }
        
        thead {
          display: table-header-group !important;
        }
        
        tfoot {
          display: table-footer-group !important;
        }
        
        /* Ensure proper column widths */
        th, td {
          page-break-inside: avoid !important;
          padding: 6px 8px !important;
          vertical-align: top !important;
        }
        
        /* Specific table layouts */
        .equipment-table th,
        .systems-table th,
        .ziplines-table th {
          white-space: nowrap !important;
          font-weight: bold !important;
        }
        
        /* Prevent awkward breaks in key sections */
        .key-section,
        .critical-box,
        .info-grid {
          page-break-inside: avoid !important;
        }
        
        /* Phase 7: Typography Refinements */
        /* Optimize font rendering for print */
        body {
          font-size: 10pt !important;
          line-height: 1.4 !important;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important;
          -webkit-font-smoothing: antialiased !important;
          -moz-osx-font-smoothing: grayscale !important;
        }
        
        /* Heading hierarchy for print */
        h1 {
          font-size: 20pt !important;
          line-height: 1.2 !important;
          margin-bottom: 12px !important;
          font-weight: 700 !important;
        }
        
        h2 {
          font-size: 14pt !important;
          line-height: 1.3 !important;
          margin-top: 10px !important;
          margin-bottom: 8px !important;
          font-weight: 600 !important;
        }
        
        h3 {
          font-size: 11pt !important;
          line-height: 1.3 !important;
          margin-top: 8px !important;
          margin-bottom: 6px !important;
          font-weight: 600 !important;
        }
        
        /* Paragraph and text spacing */
        p {
          margin-bottom: 6px !important;
          line-height: 1.4 !important;
        }
        
        /* List optimization */
        ul, ol {
          margin: 6px 0 !important;
          padding-left: 20px !important;
        }
        
        li {
          margin-bottom: 4px !important;
          line-height: 1.4 !important;
        }
        
        /* Strong emphasis visibility */
        strong, b {
          font-weight: 700 !important;
          color: #000 !important;
        }
        
        /* Phase 8: Final Polish - Result Badges and Spacing */
        /* Result badge styling with proper colors */
        .result-pass {
          background-color: #22c55e !important;
          color: #ffffff !important;
          padding: 4px 10px !important;
          border-radius: 4px !important;
          font-weight: 600 !important;
          display: inline-block !important;
        }
        
        .result-attention {
          background-color: #f59e0b !important;
          color: #ffffff !important;
          padding: 4px 10px !important;
          border-radius: 4px !important;
          font-weight: 600 !important;
          display: inline-block !important;
        }
        
        .result-fail {
          background-color: #ef4444 !important;
          color: #ffffff !important;
          padding: 4px 10px !important;
          border-radius: 4px !important;
          font-weight: 600 !important;
          display: inline-block !important;
        }
        
        /* Section spacing optimization */
        .key-section {
          margin-bottom: 10px !important;
          padding: 10px !important;
        }
        
        .critical-box {
          margin: 10px 0 !important;
          padding: 10px !important;
          border: 2px solid #ef4444 !important;
        }
        
        /* Info grid spacing */
        .info-grid {
          margin-bottom: 8px !important;
        }
        
        .info-cell {
          padding: 6px !important;
          margin-bottom: 4px !important;
        }
        
        /* Footer positioning and styling */
        .page-footer {
          font-size: 8pt !important;
          color: #666 !important;
          padding: 8px 80px 8px 0 !important;
          border-top: 1px solid #000 !important;
          margin-top: 10px !important;
        }
        
        /* Ensure proper spacing around tables */
        table {
          margin: 8px 0 !important;
        }
        
        /* Section headers */
        .section-header {
          background-color: #f3f4f6 !important;
          padding: 8px !important;
          margin: 10px 0 6px 0 !important;
          border-left: 4px solid #3b82f6 !important;
        }
      }

      /* Text optimization with overflow handling */
      body, p, li, td {
        orphans: 3;
        widows: 3;
        overflow-wrap: break-word;
        word-wrap: break-word;
      }

      /* Prevent text overflow in constrained spaces */
      p, li, td, th, div {
        max-width: 100%;
      }

      /* Optimized spacing and typography for print density */
      .page-header {
        margin-bottom: 10px;
        padding-bottom: 6px;
      }

      h1 {
        font-size: 20pt;
        line-height: 1.2;
        margin-bottom: 12px;
      }

      h2 {
        margin: 8px 0 5px 0;
        font-size: 15pt;
        line-height: 1.25;
      }

      h3 {
        margin: 6px 0 4px 0;
        font-size: 12pt;
        line-height: 1.2;
      }

      .info-grid {
        margin: 8px 0;
      }

      .info-cell {
        padding: 5px 7px;
      }

      .info-label {
        font-size: 9pt;
        margin-bottom: 2px;
      }

      .info-value {
        font-size: 10pt;
        line-height: 1.3;
      }

      .key-section, .text-block {
        padding: 7px 10px;
        margin: 7px 0;
        font-size: 9.5pt;
        line-height: 1.4;
      }

      .critical-box {
        padding: 8px 10px;
        margin: 7px 0;
      }

      table {
        margin: 7px 0;
        font-size: 9pt;
      }

      table th {
        padding: 4px 6px;
        font-size: 9.5pt;
      }

      table td {
        padding: 4px 6px;
        line-height: 1.25;
      }

      .bullet-list {
        margin: 4px 0 4px 16px;
        font-size: 9.5pt;
      }

      .bullet-list li {
        margin-bottom: 3px;
        line-height: 1.35;
      }

      .bullet-list li:last-child {
        margin-bottom: 0;
      }

      /* General list optimization */
      ul, ol {
        margin: 5px 0 5px 16px;
        padding-left: 4px;
      }

      ul li, ol li {
        margin-bottom: 3px;
        line-height: 1.35;
      }

      ul li:last-child, ol li:last-child {
        margin-bottom: 0;
      }

      .page-footer {
        font-size: 8.5pt;
        padding-top: 6px;
      }

      .disclaimer {
        font-size: 8pt;
        line-height: 1.3;
      }

      /* Ensure borders print properly */
      .page-header {
        border-bottom: 3px solid #1e40af !important;
      }

      .page-footer {
        border-top: 1px solid #000 !important;
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h1 style="text-align: center; margin-top: 10px;">Professional Inspection for Aerial Adventure Programs</h1>

      <div class="info-grid">
        <div class="info-cell">
          <span class="info-label">Organization:</span>
          <span class="info-value">${inspection.organization}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Location:</span>
          <span class="info-value">${inspection.location}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Onsite Contact:</span>
          <span class="info-value">${inspection.onsite_contact || 'N/A'}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">ACCT Course Number:</span>
          <span class="info-value">${acctNumber}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Inspected by:</span>
          <span class="info-value">${inspectorName}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Inspector ACCT #:</span>
          <span class="info-value">${acctNumber}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Date of Inspection:</span>
          <span class="info-value">${formatDate(inspection.inspection_date)}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Next Inspection Date:</span>
          <span class="info-value">${summary?.next_inspection_date ? formatDate(summary.next_inspection_date) : 'TBD'}</span>
        </div>
        ${inspection.previous_inspector ? `
        <div class="info-cell">
          <span class="info-label">Previously Inspected by:</span>
          <span class="info-value">${inspection.previous_inspector}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Prev. Inspection Date:</span>
          <span class="info-value">${formatDate(inspection.previous_inspection_date)}</span>
        </div>
        ` : ''}
      </div>

      <h2>KNOWN COURSE HISTORY</h2>
      ${inspection.course_history ? `
      <div class="text-block">${inspection.course_history}</div>
      ` : `
      <div class="text-block">
        <p>No course history provided.</p>
      </div>
      `}

      <h2>SCOPE AND LIMITATIONS OF INSPECTION</h2>
      <div class="text-block">
        <p>This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.</p>
      </div>

      <h2>REMINDERS AND REQUIREMENTS</h2>
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 5px;">INSPECTION CATEGORIES</h2>
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

      <h2 style="margin-top: 30px;">INSPECTION RESULTS KEY</h2>
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <!-- Operating Systems Section -->
      <div class="combined-section">
        <h2>SYSTEMS</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          Each operating system has been inspected for structural integrity, hardware condition, and environmental factors.
        </p>
        <table class="systems-table">
          <thead>
            <tr>
              <th>System Name</th>
              <th>Name/ID</th>
              <th>Lifeline HDW</th>
              <th>Activity HDW</th>
              <th>Comments</th>
            </tr>
          </thead>
          <tbody>
          ${systems.map(sys => {
            const resultData = formatResultCheckbox(sys.result);
            return `
              <tr>
                <td><strong>${sys.system_name}</strong></td>
                <td>${sys.name || 'N/A'}</td>
                <td style="${resultData.cellStyle}">${resultData.html}</td>
                <td style="${resultData.cellStyle}">${resultData.html}</td>
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
        <h2>ZIPLINES</h2>
        
        <div style="margin-bottom: 12px; font-size: 9.5pt; padding: 10px; background: #f8f9fa; border-left: 3px solid #1e40af;">
          <strong>Key Abbreviations:</strong><br>
          <strong>Cable Type:</strong> GAC = Galvanized Aircraft Cable, SS = Stainless Steel<br>
          <strong>Braking System:</strong> ZS = Zipstop, FB = Friction Brake, SB = Spring Brake, G = Gravity<br>
          <strong>EAD System:</strong> Energy Absorption Device
        </div>

        <table class="ziplines-table">
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
              const cableResultData = formatResultCheckbox(zip.cable_result || 'Pass');
              const brakingResultData = formatResultCheckbox(zip.braking_result || 'Pass');
              const eadResultData = formatResultCheckbox(zip.ead_result || 'Pass');
              return `
                <tr>
                  <td><strong>${zip.zipline_name}</strong></td>
                  <td style="text-align: center;">${zip.cable_type || 'N/A'}</td>
                  <td style="text-align: center;">${zip.cable_length || 'N/A'}</td>
                  <td style="${cableResultData.cellStyle}">${cableResultData.html}</td>
                  <td style="text-align: center;">${zip.braking_system || 'N/A'}</td>
                  <td style="${brakingResultData.cellStyle}">${brakingResultData.html}</td>
                  <td style="text-align: center;">${zip.ead_system || 'N/A'}</td>
                  <td style="${eadResultData.cellStyle}">${eadResultData.html}</td>
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2>SYSTEMS - OPERATING SYSTEMS</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        Each operating system has been inspected for structural integrity, hardware condition, and environmental factors.
      </p>
      <table class="systems-table">
        <thead>
          <tr>
            <th>System Name</th>
            <th>Name/ID</th>
            <th>Lifeline HDW</th>
            <th>Activity HDW</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${systems.map(sys => {
            const resultData = formatResultCheckbox(sys.result);
            return `
              <tr>
                <td><strong>${sys.system_name}</strong></td>
                <td>${sys.name || 'N/A'}</td>
                <td style="${resultData.cellStyle}">${resultData.html}</td>
                <td style="${resultData.cellStyle}">${resultData.html}</td>
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2>ZIPLINES</h2>
      
      <div style="margin-bottom: 15px; font-size: 9.5pt; padding: 10px; background: #f8f9fa; border-left: 3px solid #1e40af;">
        <strong>Key Abbreviations:</strong><br>
        <strong>Cable Type:</strong> GAC = Galvanized Aircraft Cable, SS = Stainless Steel<br>
        <strong>Braking System:</strong> ZS = Zipstop, FB = Friction Brake, SB = Spring Brake, G = Gravity<br>
        <strong>EAD System:</strong> Energy Absorption Device
      </div>

      <table class="ziplines-table">
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
            const cableResultData = formatResultCheckbox(zip.cable_result || 'Pass');
            const brakingResultData = formatResultCheckbox(zip.braking_result || 'Pass');
            const eadResultData = formatResultCheckbox(zip.ead_result || 'Pass');
            return `
              <tr>
                <td><strong>${zip.zipline_name}</strong></td>
                <td style="text-align: center;">${zip.cable_type || 'N/A'}</td>
                <td style="text-align: center;">${zip.cable_length || 'N/A'}</td>
                <td style="${cableResultData.cellStyle}">${cableResultData.html}</td>
                <td style="text-align: center;">${zip.braking_system || 'N/A'}</td>
                <td style="${brakingResultData.cellStyle}">${brakingResultData.html}</td>
                <td style="text-align: center;">${zip.ead_system || 'N/A'}</td>
                <td style="${eadResultData.cellStyle}">${eadResultData.html}</td>
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <!-- Equipment Section -->
      <div class="combined-section">
        <h2>EQUIPMENT INSPECTION</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          All equipment has been inspected in accordance with manufacturer specifications and ACCT standards.
        </p>
        
        ${['harnesses', 'helmets', 'lanyards', 'connectors', 'rope', 'belay', 'trolleys', 'other'].map(category => {
          const categoryEquipment = equipment.filter(eq => 
            eq.equipment_category === category
          );
          if (categoryEquipment.length === 0) return '';
          
          const categoryTitle = category === 'connectors' ? 'CONNECTORS (CARABINERS & QUICKLINKS)' : 
                               category === 'rope' ? 'KERNMANTLE ROPE' :
                               category === 'belay' ? 'BELAY/DESCENT DEVICES' :
                               category === 'trolleys' ? 'TROLLEYS AND PULLEYS' :
                               category === 'other' ? 'OTHER EQUIPMENT' :
                               category.toUpperCase();
          
          return `
            <h3 style="margin-top: 15px; color: #000; font-size: 11pt;">EQUIPMENT - <em>${categoryTitle}</em></h3>
            <table class="equipment-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Quantity</th>
                  <th>Year</th>
                  <th>Result</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                ${categoryEquipment.map(eq => {
                  const resultData = formatResultCheckbox(eq.result);
                  return `
                    <tr>
                      <td>${eq.equipment_type}</td>
                      <td style="text-align: center;">${eq.quantity || 'N/A'}</td>
                      <td style="text-align: center;">${eq.production_year || 'N/A'}</td>
                      <td style="${resultData.cellStyle}">${resultData.html}</td>
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
        <h2>ACCT OPERATIONS STANDARDS</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          Documentation verification as required by ACCT (Association for Challenge Course Technology) Standards. 
          The presence of documentation does not constitute review or approval of content.
        </p>

        <table class="standards-table">
          <thead>
            <tr>
              <th>Standard / Document</th>
              <th style="text-align: center;">YES</th>
              <th style="text-align: center;">NO</th>
              <th style="text-align: center;">Comments</th>
            </tr>
          </thead>
          <tbody>
            ${standards.map(std => `
              <tr>
                <td><strong>${std.standard_name}</strong></td>
                <td style="text-align: center; font-size: 12pt;">${std.has_documentation ? '☑' : '☐'}</td>
                <td style="text-align: center; font-size: 12pt;">${!std.has_documentation ? '☑' : '☐'}</td>
                <td style="font-size: 9pt;">${std.comments || '—'}</td>
              </tr>
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2>EQUIPMENT INSPECTION</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        All equipment has been inspected in accordance with manufacturer specifications and ACCT standards.
      </p>
      
      ${['harnesses', 'helmets', 'lanyards', 'connectors', 'rope', 'belay', 'trolleys', 'other'].map(category => {
        const categoryEquipment = equipment.filter(eq => 
          eq.equipment_category === category
        );
        if (categoryEquipment.length === 0) return '';
        
        const categoryTitle = category === 'connectors' ? 'CONNECTORS (CARABINERS & QUICKLINKS)' : 
                             category === 'rope' ? 'KERNMANTLE ROPE' :
                             category === 'belay' ? 'BELAY/DESCENT DEVICES' :
                             category === 'trolleys' ? 'TROLLEYS AND PULLEYS' :
                             category === 'other' ? 'OTHER EQUIPMENT' :
                             category.toUpperCase();
        
        return `
          <h3 style="margin-top: 20px; color: #000; font-size: 11pt;">EQUIPMENT - <em>${categoryTitle}</em></h3>
          <table class="equipment-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Quantity</th>
                <th>Year</th>
                <th>Result</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              ${categoryEquipment.map(eq => {
                const resultData = formatResultCheckbox(eq.result);
                return `
                  <tr>
                    <td>${eq.equipment_type}</td>
                    <td style="text-align: center;">${eq.quantity || 'N/A'}</td>
                    <td style="text-align: center;">${eq.production_year || 'N/A'}</td>
                    <td style="${resultData.cellStyle}">${resultData.html}</td>
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2>ACCT OPERATIONS STANDARDS</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        Documentation verification as required by ACCT (Association for Challenge Course Technology) Standards. 
        The presence of documentation does not constitute review or approval of content.
      </p>

      <table class="standards-table">
        <thead>
          <tr>
            <th>Standard / Document</th>
            <th style="text-align: center;">YES</th>
            <th style="text-align: center;">NO</th>
            <th style="text-align: center;">Comments</th>
          </tr>
        </thead>
        <tbody>
          ${standards.map(std => `
            <tr>
              <td><strong>${std.standard_name}</strong></td>
              <td style="text-align: center; font-size: 12pt;">${std.has_documentation ? '☑' : '☐'}</td>
              <td style="text-align: center; font-size: 12pt;">${!std.has_documentation ? '☑' : '☐'}</td>
              <td style="font-size: 9pt;">${std.comments || '—'}</td>
            </tr>
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
        <img src="${ropeWorksLogo}" alt="Rope Works">
      </div>
      <div class="header-center">
        <div class="header-title">ROPES/CHALLENGE COURSE</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 10px; margin-bottom: 20px;">INSPECTION SUMMARY</h2>

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
        
        <table style="width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt;">
          <thead>
            <tr>
              <th style="background: #e5e7eb; color: #000; padding: 8px; text-align: left; font-weight: bold; border: 1px solid #000; width: 50%;">Retirement Criteria</th>
              <th style="background: #e5e7eb; color: #000; padding: 8px; text-align: left; font-weight: bold; border: 1px solid #000; width: 50%;">Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Manufacturer's Lifespan</td>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Manufacturer's recommended lifespan has been exceeded</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Visible Damage</td>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Visible damage, wear, or deterioration affecting structural integrity</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Impact/Shock Loading</td>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Equipment subjected to impact forces or shock loading beyond design parameters</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Missing Markings</td>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Missing or illegible manufacturer identification markings</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Fails Inspection</td>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Equipment fails inspection criteria outlined in current ACCT standards</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Incomplete Documentation</td>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Incomplete or unavailable documentation of equipment history</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Incident Involvement</td>
              <td style="padding: 8px; border: 1px solid #000; vertical-align: top;">Equipment is involved in any incident resulting in injury or near-miss</td>
            </tr>
          </tbody>
        </table>
        
        <div style="margin-top: 15px; padding: 12px; border: 1px solid #000;">
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