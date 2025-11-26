import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Hardcoded base64-encoded logos (embedded directly to avoid storage bucket dependencies)
// Rope Works Logo - converted from uploaded file
const ROPE_WORKS_LOGO_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ACCT Accredited Vendor Logo - converted from uploaded file  
const ACCT_LOGO_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { inspectionId } = await req.json();

    if (!inspectionId) {
      throw new Error('Inspection ID is required');
    }

    console.log('Fetching inspection data for HTML generation:', inspectionId);

    // Fetch all data in parallel
    const [
      { data: inspection, error: inspectionError },
      { data: systems, error: systemsError },
      { data: ziplines, error: ziplinesError },
      { data: equipment, error: equipmentError },
      { data: standards, error: standardsError },
      { data: summary, error: summaryError },
      { data: inspectorProfile, error: profileError }
    ] = await Promise.all([
      supabase.from('inspections').select('*').eq('id', inspectionId).single(),
      supabase.from('inspection_systems').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_ziplines').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_equipment').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_standards').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_summary').select('*').eq('inspection_id', inspectionId).maybeSingle(),
      supabase.from('profiles').select('*').eq('id', user.id).single()
    ]);

    if (inspectionError) throw inspectionError;

    // Authorization check
    const isSuperAdmin = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'super_admin').single();
    if (!isSuperAdmin.data && inspection.inspector_id !== user.id) {
      throw new Error('Unauthorized to generate this report');
    }

    // Helper functions
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return 'N/A';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const stripHtml = (html: string | null) => {
      if (!html) return '';
      let text = html.replace(/<[^>]*>/g, '');
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');
      text = text.replace(/&quot;/g, '"');
      text = text.replace(/&#39;/g, "'");
      text = text.replace(/&nbsp;/g, ' ');
      return text.trim();
    };

    const inspectorName = `${inspectorProfile?.first_name || ''} ${inspectorProfile?.last_name || ''}`.trim() || 'Inspector';

    // Helper function to deduplicate HTML list items
    const deduplicateHtmlList = (html: string | null): string => {
      if (!html || !html.includes('<li>')) return html || '';
      
      // Extract all <li> items
      const liRegex = /<li>(.*?)<\/li>/gi;
      const matches = html.matchAll(liRegex);
      const items: string[] = [];
      const seenLower = new Set<string>();
      
      for (const match of matches) {
        const content = match[1].trim();
        const lowerContent = content.toLowerCase();
        
        // Only add if we haven't seen this exact item (case-insensitive)
        if (!seenLower.has(lowerContent)) {
          items.push(content);
          seenLower.add(lowerContent);
        }
      }
      
      if (items.length === 0) return html;
      
      // Rebuild as clean HTML list
      return '<ul>\n' + items.map(item => `  <li>${item}</li>`).join('\n') + '\n</ul>';
    };

    // Deduplicate summary fields
    const cleanedSummary = {
      ...summary,
      repairs_performed: deduplicateHtmlList(summary?.repairs_performed),
      critical_actions: deduplicateHtmlList(summary?.critical_actions),
      future_considerations: summary?.future_considerations || '',
      next_inspection_date: summary?.next_inspection_date || null,
    };

    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inspection Report - ${stripHtml(inspection.organization)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    @page { 
      margin: 1in 0.75in 0.75in 0.75in; 
      size: letter;
    }
    
    body {
      font-family: Georgia, 'Times New Roman', Times, serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #000;
      background: #fff;
    }
    
    .page {
      max-width: 8.5in;
      margin: 0 auto;
      padding: 0 0.75in;
      background: white;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 2px solid #000;
      margin-bottom: 20px;
    }
    
    .header-left { flex: 1; }
    .header-left img { height: 60px; width: auto; }
    .header-right { flex: 0 0 auto; }
    .header-right img { height: 80px; width: auto; }
    
    .report-title {
      text-align: center;
      font-size: 16pt;
      font-weight: bold;
      margin: 15px 0 20px 0;
      font-family: Arial, sans-serif;
    }
    
    .footer {
      position: fixed;
      bottom: 0;
      left: 0.75in;
      right: 0.75in;
      border-top: 1px solid #000;
      padding-top: 8px;
      font-size: 9pt;
      line-height: 1.3;
    }
    
    @media print {
      .footer { position: fixed; bottom: 0.5in; }
    }
    
    .facility-info { margin-bottom: 25px; }
    
    .facility-row {
      display: flex;
      gap: 20px;
      margin-bottom: 12px;
      font-size: 11pt;
    }
    
    .facility-field {
      flex: 1;
      display: flex;
      align-items: baseline;
    }
    
    .facility-label {
      font-weight: bold;
      white-space: nowrap;
      margin-right: 5px;
    }
    
    .facility-value {
      flex: 1;
      border-bottom: 1px dotted #000;
      min-height: 20px;
      padding: 0 5px;
    }
    
    .course-history {
      border: 1px dotted #000;
      padding: 12px;
      margin-top: 15px;
      min-height: 80px;
    }
    
    .course-history-label {
      font-weight: bold;
      margin-bottom: 8px;
    }
    
    .section {
      margin-bottom: 25px;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: 14pt;
      font-weight: bold;
      font-family: Arial, sans-serif;
      margin-bottom: 12px;
      color: #000;
    }
    
    .disclaimer {
      font-size: 10pt;
      line-height: 1.5;
      margin-bottom: 20px;
      text-align: justify;
    }
    
    .reminders { margin-top: 20px; }
    
    .reminders-title {
      font-size: 12pt;
      font-weight: bold;
      margin-bottom: 10px;
    }
    
    .reminders ul {
      margin-left: 25px;
      margin-bottom: 15px;
    }
    
    .reminders li {
      margin-bottom: 8px;
      line-height: 1.5;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      font-size: 10pt;
    }
    
    th, td {
      border: 1px solid #000;
      padding: 6px 8px;
      text-align: left;
    }
    
    th {
      background: #fff;
      font-weight: bold;
      font-family: Arial, sans-serif;
    }
    
    tr:nth-child(even) { background: #f9f9f9; }
    
    .key-table th { background: #e8e8e8; }
    
    .key-table td:first-child {
      font-weight: bold;
      width: 25%;
    }
    
    .page-break { page-break-after: always; }
    .no-break { page-break-inside: avoid; }
    
    .signature-section {
      margin-top: 40px;
      border-top: 2px solid #000;
      padding-top: 20px;
    }
    
    .signature-line {
      border-bottom: 1px solid #000;
      width: 300px;
      margin: 30px 0 5px 0;
    }
    
    .signature-label { font-size: 10pt; }
    
    @media screen {
      body {
        background: #e5e5e5;
        padding: 20px;
      }
      
      .page {
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        margin-bottom: 20px;
        padding: 0.75in;
      }
      
      .footer {
        position: relative;
        left: 0;
        right: 0;
        margin-top: 40px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
      <div class="header">
        <div class="header-left">
          <img src="${ROPE_WORKS_LOGO_BASE64}" alt="Rope Works Logo">
        </div>
        <div class="header-right">
          <img src="${ACCT_LOGO_BASE64}" alt="ACCT Accredited Vendor">
        </div>
      </div>
    
    <div class="report-title">Professional Inspection for Aerial Adventure Programs</div>

    <div class="facility-info">
      <div class="facility-row">
        <div class="facility-field">
          <span class="facility-label">Organization:</span>
          <span class="facility-value">${stripHtml(inspection.organization)}</span>
        </div>
        <div class="facility-field">
          <span class="facility-label">Location:</span>
          <span class="facility-value">${stripHtml(inspection.location)}</span>
        </div>
        <div class="facility-field">
          <span class="facility-label">Onsite Contact:</span>
          <span class="facility-value">${stripHtml(inspection.onsite_contact) || ''}</span>
        </div>
      </div>
      
      <div class="facility-row">
        <div class="facility-field">
          <span class="facility-label">Inspection Date:</span>
          <span class="facility-value">${formatDate(inspection.inspection_date)}</span>
        </div>
        <div class="facility-field">
          <span class="facility-label">Inspector:</span>
          <span class="facility-value">${inspectorName}</span>
        </div>
        <div class="facility-field">
          <span class="facility-label">ACCT #:</span>
          <span class="facility-value">${stripHtml(inspection.acct_number) || ''}</span>
        </div>
      </div>
      
      ${inspection.previous_inspection_date || inspection.previous_inspector ? `
      <div class="facility-row">
        ${inspection.previous_inspection_date ? `
        <div class="facility-field">
          <span class="facility-label">Previous Inspection:</span>
          <span class="facility-value">${formatDate(inspection.previous_inspection_date)}</span>
        </div>
        ` : ''}
        ${inspection.previous_inspector ? `
        <div class="facility-field">
          <span class="facility-label">Previous Inspector:</span>
          <span class="facility-value">${stripHtml(inspection.previous_inspector)}</span>
        </div>
        ` : ''}
      </div>
      ` : ''}
      
      ${inspection.course_history ? `
      <div class="course-history">
        <div class="course-history-label">Known Course History:</div>
        <div>${stripHtml(inspection.course_history)}</div>
      </div>
      ` : ''}
    </div>
    
    <div class="section">
      <div class="disclaimer">
        This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.
      </div>
      
      <div class="reminders">
        <div class="reminders-title">Reminders and Requirements:</div>
        <ul>
          <li>Employers are required to issue staff appropriate fall protection for the duties to be performed.</li>
          <li>A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.</li>
          <li>Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.</li>
          <li>Proper staff training should be provided for the operation of all aerial activities and equipment on your site.</li>
          <li>Operational Reviews shall be conducted once every five years.</li>
        </ul>
      </div>
    </div>
    
    <div class="page-break"></div>
    
    <div class="section">
      <h2 class="section-title">All inspections include the following when applicable:</h2>
      
      <table class="key-table">
        <tr>
          <th>Category</th>
          <th>Description</th>
        </tr>
        <tr>
          <td>Lifeline HDW</td>
          <td>Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, &amp; redundant terminations.</td>
        </tr>
        <tr>
          <td>Activity HDW</td>
          <td>Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, etc.</td>
        </tr>
        <tr>
          <td>Environment</td>
          <td>This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, trees, rocks, &amp; terrain.</td>
        </tr>
        <tr>
          <td>Equipment</td>
          <td>This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, etc.</td>
        </tr>
        <tr>
          <td>Pass/Pass with Provisions/Fail</td>
          <td>This represents the overall rating for the system based on the condition of the items inspected on the day of the inspection. Rope Works Inc. inspects all challenge course and canopy/zip line tours to the standards set forth by the ACCT. Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the Comment section.</td>
        </tr>
      </table>
      
      <h3 style="margin-top: 20px; margin-bottom: 10px; font-size: 12pt;">Inspection Key:</h3>
      
      <table class="key-table">
        <tr>
          <th>Rating</th>
          <th>Definition</th>
        </tr>
        <tr>
          <td>Pass</td>
          <td>The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection. No corrective actions are necessary. The item is approved for continued use until the next scheduled inspection.</td>
        </tr>
        <tr>
          <td>Pass with Provisions</td>
          <td>The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern.
            <ul style="margin-top: 8px; margin-left: 20px;">
              <li>Written comments will specify the condition, recommended action, and timeline for compliance.</li>
              <li>Items rated "Pass with Provisions" may be reclassified as "Fail" if unaddressed by the next inspection cycle.</li>
            </ul>
          </td>
        </tr>
        <tr>
          <td>Fail</td>
          <td>The equipment or operating system does not meet minimum safety or operational standards and presents a potential or immediate hazard. The item must be removed from service and repaired, replaced, or corrected before being used again. Documentation of corrective actions is required prior to reinspection and approval for use.</td>
        </tr>
        <tr>
          <td>N/A</td>
          <td>Not applicable, Not inspected, or inaccessible/not available at the time of inspection.</td>
        </tr>
      </table>
    </div>
    
    <div class="page-break"></div>

    ${systems && systems.length > 0 ? `
    <div class="section">
      <h2 class="section-title">Operating Systems</h2>
      <table>
        <thead>
          <tr>
            <th>System Name</th>
            <th>Result</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${systems.map(sys => `
            <tr>
              <td>${stripHtml(sys.system_name || sys.name)}</td>
              <td>${sys.result || 'N/A'}</td>
              <td>${stripHtml(sys.comments) || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${ziplines && ziplines.length > 0 ? `
    <div class="section">
      <h2 class="section-title">Ziplines</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Cable Type</th>
            <th>Length</th>
            <th>Braking</th>
            <th>EAD</th>
            <th>Result</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${ziplines.map(zip => `
            <tr>
              <td>${stripHtml(zip.zipline_name)}</td>
              <td>${stripHtml(zip.cable_type) || 'N/A'}</td>
              <td>${zip.cable_length ? zip.cable_length + 'ft' : 'N/A'}</td>
              <td>${stripHtml(zip.braking_system) || 'N/A'}</td>
              <td>${stripHtml(zip.ead_system) || 'N/A'}</td>
              <td>${zip.result || 'N/A'}</td>
              <td>${stripHtml(zip.comments) || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${equipment && equipment.length > 0 ? `
    <div class="section">
      <h2 class="section-title">Equipment</h2>
      ${['PPE', 'Hardware', 'Software', 'Belay Devices'].map(category => {
        const items = equipment.filter(e => e.equipment_category === category);
        if (items.length === 0) return '';
        return `
          <h3 style="font-size: 11pt; font-weight: bold; margin: 15px 0 8px 0;">${category}</h3>
          <table>
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
              ${items.map(eq => `
                <tr>
                  <td>${stripHtml(eq.equipment_type)}</td>
                  <td>${eq.quantity || 'N/A'}</td>
                  <td>${eq.production_year || 'N/A'}</td>
                  <td>${eq.result || 'N/A'}</td>
                  <td>${stripHtml(eq.comments) || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }).join('')}
    </div>
    ` : ''}

    ${standards && standards.length > 0 ? `
    <div class="section">
      <h2 class="section-title">Standards Compliance</h2>
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
              <td>${stripHtml(std.standard_name)}</td>
              <td>${std.has_documentation ? 'Yes' : 'No'}</td>
              <td>${stripHtml(std.comments) || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${cleanedSummary ? `
    <div class="section no-break">
      <h2 class="section-title">Report Summary</h2>
      ${cleanedSummary.repairs_performed ? `
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px;">Repairs, Alterations performed during inspection:</h3>
        <div style="line-height: 1.5;">${cleanedSummary.repairs_performed}</div>
      </div>
      ` : ''}
      ${cleanedSummary.critical_actions ? `
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px;">*Critical Action = Required Changes Prior to use of Activity, Element, or Equipment</h3>
        <div style="line-height: 1.5;">${cleanedSummary.critical_actions}</div>
      </div>
      ` : ''}
      ${cleanedSummary.future_considerations ? `
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px;">Future Considerations (includes but not limited to age of course, recommended updates, suggestions, industry future)</h3>
        <div style="line-height: 1.5;">${stripHtml(cleanedSummary.future_considerations)}</div>
      </div>
      ` : ''}
      ${cleanedSummary.next_inspection_date ? `
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px;">Next Inspection Date</h3>
        <div>${formatDate(cleanedSummary.next_inspection_date)}</div>
      </div>
      ` : ''}
    </div>
    ` : ''}

    <div class="section no-break">
      <h3 style="font-weight: bold; margin-bottom: 10px; font-size: 11pt;">General Rope Works Inspection Retirement Guidelines: These are generalized and are not a substitute for the Pre use inspection.</h3>
      <table>
        <tr>
          <td style="width: 30%; font-weight: bold;">Harness</td>
          <td>Manufacture maximum use or condition warranted at time of inspection</td>
        </tr>
        <tr>
          <td style="width: 30%; font-weight: bold;">Lanyards</td>
          <td>Manufacture maximum use or condition warranted at time of inspection</td>
        </tr>
        <tr>
          <td style="width: 30%; font-weight: bold;">Kernmantle Rope</td>
          <td>5 years or 1000 loads when used with top rope systems<br/>5 years or 300 loads, whichever comes first when used on aerial leap activities</td>
        </tr>
        <tr>
          <td style="width: 30%; font-weight: bold;">Helmets</td>
          <td>Manufacture maximum use or condition warranted at time of inspection</td>
        </tr>
        <tr>
          <td style="width: 30%; font-weight: bold;">Pulleys, Trolleys, Carabiners, Belay/descent devices, Cable grabs</td>
          <td>Manufacture maximum use or condition warranted at time of inspection</td>
        </tr>
      </table>
    </div>

    <div class="signature-section">
      <div class="signature-line"></div>
      <div class="signature-label">Inspector Signature</div>
      
      <div style="margin-top: 30px;">
        <div class="signature-line"></div>
        <div class="signature-label">Date</div>
      </div>
    </div>
  </div>
  
  <div class="footer">
    The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection. Issued by: Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620
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
