import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function loadLogoAsBase64(supabase: any, bucketName: string, filePath: string): Promise<string> {
  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .download(filePath);

    if (error) {
      console.error(`Error loading ${filePath}:`, error);
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    }

    const arrayBuffer = await data.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error(`Exception loading ${filePath}:`, error);
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  }
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

    // Load logos from storage
    const ropeWorksLogo = await loadLogoAsBase64(supabase, 'pdf-templates', 'rope-works-logo.png');
    const acctLogo = await loadLogoAsBase64(supabase, 'pdf-templates', 'acct-accredited-vendor.png');

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

    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inspection Report - ${inspection.organization}</title>
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
      padding: 20px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      background: white;
      padding: 40px;
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
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    .info-item {
      padding: 12px;
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
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    th {
      background: #f1f5f9;
      font-weight: 600;
      color: #1e293b;
      font-size: 14px;
    }
    td {
      font-size: 14px;
    }
    .result-pass {
      color: #16a34a;
      font-weight: 600;
    }
    .result-attention {
      color: #ea580c;
      font-weight: 600;
    }
    .result-fail {
      color: #dc2626;
      font-weight: 600;
    }
    .text-content {
      padding: 15px;
      background: #f8fafc;
      border-radius: 4px;
      white-space: pre-wrap;
      line-height: 1.8;
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
      .header {
        flex-direction: column;
        text-align: center;
      }
      .header-right {
        text-align: center;
        margin-top: 15px;
      }
      .info-grid {
        grid-template-columns: 1fr;
      }
      .container {
        padding: 20px;
      }
      table {
        font-size: 12px;
      }
      th, td {
        padding: 8px 4px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <img src="${ropeWorksLogo}" alt="Rope Works Logo" class="logo">
        <h1>Inspection Report</h1>
        <div class="subtitle">Professional Aerial Adventure Park Inspection</div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor" class="badge">
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Organization</div>
        <div class="info-value">${inspection.organization}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Location</div>
        <div class="info-value">${inspection.location}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Inspection Date</div>
        <div class="info-value">${formatDate(inspection.inspection_date)}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Inspector</div>
        <div class="info-value">${inspectorName}</div>
      </div>
      <div class="info-item">
        <div class="info-label">ACCT Number</div>
        <div class="info-value">${acctNumber}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Onsite Contact</div>
        <div class="info-value">${inspection.onsite_contact || "N/A"}</div>
      </div>
      ${inspection.previous_inspection_date ? `
      <div class="info-item">
        <div class="info-label">Previous Inspection</div>
        <div class="info-value">${formatDate(inspection.previous_inspection_date)}</div>
      </div>
      ` : ''}
      ${inspection.previous_inspector ? `
      <div class="info-item">
        <div class="info-label">Previous Inspector</div>
        <div class="info-value">${inspection.previous_inspector}</div>
      </div>
      ` : ''}
    </div>

    ${inspection.course_history ? `
    <div class="section">
      <div class="section-title">Course History</div>
      <div class="text-content">${inspection.course_history}</div>
    </div>
    ` : ''}

    ${standards.length > 0 ? `
    <div class="section">
      <div class="section-title">Standards & Documentation</div>
      <table>
        <thead>
          <tr>
            <th>Standard</th>
            <th>Documentation</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${standards.map(std => `
            <tr>
              <td>${std.standard_name}</td>
              <td>${std.has_documentation ? '<span class="result-pass">✓ Yes</span>' : '<span class="result-attention">✗ No</span>'}</td>
              <td>${std.comments || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${systems.length > 0 ? `
    <div class="section">
      <div class="section-title">Operating Systems</div>
      <table>
        <thead>
          <tr>
            <th>System Name</th>
            <th>Name/ID</th>
            <th>Result</th>
            <th>Comments</th>
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
                <td>${sys.comments || ''}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${ziplines.length > 0 ? `
    <div class="section">
      <div class="section-title">Ziplines</div>
      <table>
        <thead>
          <tr>
            <th>Zipline</th>
            <th>Cable Type</th>
            <th>Length (ft)</th>
            <th>Braking</th>
            <th>EAD</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          ${ziplines.map(zip => {
            let resultClass = 'result-pass';
            if (zip.result === 'Needs Attention') resultClass = 'result-attention';
            if (zip.result === 'Fail') resultClass = 'result-fail';
            
            return `
              <tr>
                <td>${zip.zipline_name}</td>
                <td>${zip.cable_type || 'N/A'}</td>
                <td>${zip.cable_length || 'N/A'}</td>
                <td>${zip.braking_system || 'N/A'}</td>
                <td>${zip.ead_system || 'N/A'}</td>
                <td class="${resultClass}">${zip.result}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${equipment.length > 0 ? `
    <div class="section">
      <div class="section-title">Equipment</div>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Type</th>
            <th>Quantity</th>
            <th>Year</th>
            <th>Result</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${equipment.map(eq => {
            let resultClass = 'result-pass';
            if (eq.result === 'Needs Attention') resultClass = 'result-attention';
            if (eq.result === 'Fail') resultClass = 'result-fail';
            
            return `
              <tr>
                <td>${eq.equipment_category}</td>
                <td>${eq.equipment_type}</td>
                <td>${eq.quantity || 'N/A'}</td>
                <td>${eq.production_year || 'N/A'}</td>
                <td class="${resultClass}">${eq.result}</td>
                <td>${eq.comments || ''}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${summary ? `
    <div class="section">
      <div class="section-title">Summary</div>
      
      ${summary.repairs_performed ? `
      <div style="margin-bottom: 20px;">
        <div class="info-label" style="margin-bottom: 8px;">Repairs Performed</div>
        <div class="text-content">${deduplicateHtmlContent(summary.repairs_performed)}</div>
      </div>
      ` : ''}
      
      ${summary.critical_actions ? `
      <div style="margin-bottom: 20px;">
        <div class="info-label" style="margin-bottom: 8px; color: #dc2626;">Critical Actions Required</div>
        <div class="text-content">${deduplicateHtmlContent(summary.critical_actions)}</div>
      </div>
      ` : ''}
      
      ${summary.future_considerations ? `
      <div style="margin-bottom: 20px;">
        <div class="info-label" style="margin-bottom: 8px;">Future Considerations</div>
        <div class="text-content">${summary.future_considerations}</div>
      </div>
      ` : ''}
      
      ${summary.next_inspection_date ? `
      <div class="info-item" style="display: inline-block; margin-top: 10px;">
        <div class="info-label">Next Inspection Date</div>
        <div class="info-value">${formatDate(summary.next_inspection_date)}</div>
      </div>
      ` : ''}
    </div>
    ` : ''}

    <div class="footer">
      <p>Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      <p style="margin-top: 5px;">Rope Works Professional Inspection Report</p>
    </div>
  </div>
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
    console.error("Error generating inspection HTML:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
