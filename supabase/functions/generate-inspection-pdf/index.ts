import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    console.log('Fetching inspection data for:', inspectionId);

    // Fetch all data
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

    console.log('Generating PDF with Puppeteer...');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    const htmlContent = await generateHTML(inspection, systems || [], ziplines || [], equipment || [], standards || [], summary, inspectorProfile);
    
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0'
    });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.5in',
        bottom: '0.75in',
        left: '0.5in',
        right: '0.5in'
      }
    });

    await browser.close();

    console.log('PDF generated, uploading to storage...');

    // Upload to storage
    const fileName = `inspection-${inspectionId}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('inspection-reports')
      .getPublicUrl(fileName);

    // Save to database
    const { data: reportData, error: reportError } = await supabase
      .from('inspection_reports')
      .insert({
        inspection_id: inspectionId,
        pdf_url: fileName,
        generated_by: user.id,
        file_size_bytes: pdfBuffer.length
      })
      .select()
      .single();

    if (reportError) throw reportError;

    console.log('Report saved successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        url: publicUrl,
        report: reportData
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

// Logo base64 strings - these are embedded ACCT and Rope Works logos
// To update: convert your logo images to base64 and replace these strings
const ACCT_LOGO_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const ROPE_WORKS_LOGO_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function generateHTML(
  inspection: any,
  systems: any[],
  ziplines: any[],
  equipment: any[],
  standards: any[],
  summary: any,
  inspectorProfile: any
): Promise<string> {
  const inspectorName = inspectorProfile 
    ? `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim() || 'Inspector'
    : 'Inspector';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>${getStyles()}</style>
    </head>
    <body>
      ${generateCoverPage(inspection, inspectorName, ACCT_LOGO_BASE64, ROPE_WORKS_LOGO_BASE64)}
      ${generateDefinitionsPage(ACCT_LOGO_BASE64, ROPE_WORKS_LOGO_BASE64)}
      ${generateSystemsPage(systems, ACCT_LOGO_BASE64, ROPE_WORKS_LOGO_BASE64)}
      ${ziplines.length > 0 ? generateZiplinesPage(ziplines, ACCT_LOGO_BASE64, ROPE_WORKS_LOGO_BASE64) : ''}
      ${equipment.length > 0 ? generateEquipmentPage(equipment, ACCT_LOGO_BASE64, ROPE_WORKS_LOGO_BASE64) : ''}
      ${generateStandardsPage(standards, ACCT_LOGO_BASE64, ROPE_WORKS_LOGO_BASE64)}
      ${generateSummaryPage(summary, inspection, ACCT_LOGO_BASE64, ROPE_WORKS_LOGO_BASE64)}
    </body>
    </html>
  `;
}

function getStyles(): string {
  return `
    @page {
      size: Letter;
      margin: 0.5in 0.5in 0.75in 0.5in;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Helvetica', 'Arial', sans-serif;
      font-size: 10pt;
      color: #000;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      page-break-after: always;
      position: relative;
      min-height: 100vh;
    }

    .page:last-child {
      page-break-after: avoid;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 1px solid #999;
    }

    .header-left img,
    .header-right img {
      height: 50px;
      width: auto;
    }

    .header-center {
      text-align: center;
      flex: 1;
      padding: 0 20px;
    }

    .header-center h1 {
      font-size: 10pt;
      color: #666;
      font-weight: normal;
      letter-spacing: 0.5px;
    }

    .title {
      text-align: center;
      font-size: 13pt;
      font-weight: bold;
      margin: 15px 0;
    }

    .form-row {
      display: flex;
      gap: 20px;
      margin-bottom: 12px;
    }

    .form-field {
      flex: 1;
    }

    .form-field label {
      font-size: 9pt;
      color: #000;
      font-weight: normal;
      display: block;
      margin-bottom: 2px;
    }

    .form-field .value {
      border-bottom: 1px solid #000;
      padding: 2px 5px;
      min-height: 18px;
      font-size: 9pt;
    }

    .section-heading {
      font-size: 10pt;
      font-weight: bold;
      margin: 15px 0 8px 0;
    }

    .history-box {
      border: 1px solid #000;
      padding: 10px;
      margin: 10px 0;
      min-height: 50px;
      font-size: 9pt;
      line-height: 1.3;
    }

    .disclaimer,
    .reminders {
      font-size: 8pt;
      line-height: 1.35;
      margin: 12px 0;
      text-align: justify;
    }

    .disclaimer p {
      margin-bottom: 8px;
    }

    .reminders ul {
      margin-left: 18px;
      margin-top: 5px;
    }

    .reminders li {
      margin-bottom: 4px;
    }

    .footer {
      position: fixed;
      bottom: 0;
      left: 0.5in;
      right: 0.5in;
      text-align: center;
      font-size: 7pt;
      color: #666;
      padding: 8px 0;
      border-top: 1px solid #ccc;
    }

    .definitions-section {
      margin: 15px 0;
    }

    .def-item {
      margin-bottom: 10px;
    }

    .def-item h3 {
      font-size: 10pt;
      font-weight: bold;
      margin-bottom: 3px;
    }

    .def-item p {
      font-size: 9pt;
      line-height: 1.3;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 9pt;
    }

    table th {
      background-color: #e8e8e8;
      padding: 6px 8px;
      text-align: left;
      border: 1px solid #999;
      font-weight: bold;
      font-size: 9pt;
    }

    table td {
      padding: 5px 8px;
      border: 1px solid #999;
      vertical-align: top;
      font-size: 9pt;
    }

    .page-break {
      page-break-before: always;
    }

    h2 {
      font-size: 11pt;
      font-weight: bold;
      margin: 15px 0 10px 0;
    }

    h3 {
      font-size: 10pt;
      font-weight: bold;
      margin: 12px 0 6px 0;
    }

    .equipment-section {
      margin-bottom: 20px;
    }

    .equipment-section h3 {
      background-color: #f5f5f5;
      padding: 5px 8px;
      border-left: 3px solid #666;
      margin-bottom: 8px;
    }
  `;
}

function generateCoverPage(inspection: any, inspectorName: string, acctLogo: string, ropeWorksLogo: string): string {
  return `
    <div class="page">
      <div class="header">
        <div class="header-left">
          <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
        </div>
        <div class="header-center">
          <h1>ROPES/CHALLENGE COURSE</h1>
        </div>
        <div class="header-right">
          <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
        </div>
      </div>

      <div class="title">
        Professional Inspection for Aerial Adventure Programs
      </div>

      <div class="form-row">
        <div class="form-field">
          <label>Organization:</label>
          <div class="value">${sanitize(inspection.organization)}</div>
        </div>
        <div class="form-field">
          <label>Location:</label>
          <div class="value">${sanitize(inspection.location)}</div>
        </div>
        <div class="form-field">
          <label>Onsite Contact:</label>
          <div class="value">${sanitize(inspection.onsite_contact || '')}</div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-field">
          <label>Inspected by:</label>
          <div class="value">${sanitize(inspectorName)}</div>
        </div>
        <div class="form-field">
          <label>Date of Inspection:</label>
          <div class="value">${formatDate(inspection.inspection_date)}</div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-field">
          <label>Previously Inspector:</label>
          <div class="value">${sanitize(inspection.previous_inspector || '')}</div>
        </div>
        <div class="form-field">
          <label>Prev. Inspection Date:</label>
          <div class="value">${inspection.previous_inspection_date ? formatDate(inspection.previous_inspection_date) : 'N/A'}</div>
        </div>
      </div>

      <div class="section-heading">Known Course History</div>
      <div class="history-box">
        ${sanitize(inspection.course_history || '')}
      </div>

      <div class="disclaimer">
        <p>This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.</p>
      </div>

      <div class="section-heading">Reminders and Requirements</div>
      <div class="reminders">
        <ul>
          <li>Employers are required to issue staff appropriate fall protection for the duties to be performed.</li>
          <li>A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.</li>
          <li>Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.</li>
          <li>Proper staff training should be provided for the operation of all aerial activities and equipment on your site.</li>
          <li>Operational Reviews shall be conducted once every five years.</li>
        </ul>
      </div>

      <div class="footer">
        The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection. Issued by: Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620
      </div>
    </div>
  `;
}

function generateDefinitionsPage(acctLogo: string, ropeWorksLogo: string): string {
  return `
    <div class="page page-break">
      <div class="header">
        <div class="header-left">
          <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
        </div>
        <div class="header-center">
          <h1>ROPES/CHALLENGE COURSE</h1>
        </div>
        <div class="header-right">
          <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
        </div>
      </div>

      <h2>All inspections include the following when applicable:</h2>

      <div class="definitions-section">
        <div class="def-item">
          <h3>Lifeline HDW</h3>
          <p>Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, & redundant terminations.</p>
        </div>

        <div class="def-item">
          <h3>Activity HDW</h3>
          <p>Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, etc.</p>
        </div>

        <div class="def-item">
          <h3>Environment</h3>
          <p>This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, trees, rocks, & terrain.</p>
        </div>

        <div class="def-item">
          <h3>Equipment</h3>
          <p>This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, etc.</p>
        </div>

        <div class="def-item">
          <h3>Pass/Pass with Provisions/Fail</h3>
          <p>This represents the overall rating for the system based on the condition of the items inspected on the day of the inspection. Rope Works Inc. inspects all challenge course and canopy/zip line tours to the standards set forth by the ACCT. Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the Comment section.</p>
        </div>
      </div>

      <h2>Inspection Key</h2>

      <div class="definitions-section">
        <div class="def-item">
          <h3>Pass</h3>
          <p>The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection. No corrective actions are necessary. The item is approved for continued use until the next scheduled inspection.</p>
        </div>

        <div class="def-item">
          <h3>Pass with Provisions</h3>
          <p>The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern.</p>
        </div>

        <div class="def-item">
          <h3>Fail</h3>
          <p>The equipment or operating system does not meet current safety standards or manufacturer specifications and poses a potential safety risk. Immediate corrective action is required before the item can be returned to service.</p>
        </div>
      </div>
    </div>
  `;
}

function generateSystemsPage(systems: any[], acctLogo: string, ropeWorksLogo: string): string {
  if (!systems || systems.length === 0) {
    return `
      <div class="page page-break">
        <div class="header">
          <div class="header-left">
            <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
          </div>
          <div class="header-center">
            <h1>ROPES/CHALLENGE COURSE</h1>
          </div>
          <div class="header-right">
            <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
          </div>
        </div>
        <h2>Operating Systems</h2>
        <p>No operating systems recorded for this inspection.</p>
      </div>
    `;
  }

  const rows = systems.map(sys => `
    <tr>
      <td>${sanitize(sys.system_name || sys.name)}</td>
      <td>${sanitize(sys.result)}</td>
      <td>${sanitize(sys.comments || '')}</td>
    </tr>
  `).join('');

  return `
    <div class="page page-break">
      <div class="header">
        <div class="header-left">
          <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
        </div>
        <div class="header-center">
          <h1>ROPES/CHALLENGE COURSE</h1>
        </div>
        <div class="header-right">
          <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
        </div>
      </div>

      <h2>Operating Systems</h2>

      <table>
        <thead>
          <tr>
            <th style="width: 30%">System Name</th>
            <th style="width: 20%">Result</th>
            <th style="width: 50%">Comments</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function generateZiplinesPage(ziplines: any[], acctLogo: string, ropeWorksLogo: string): string {
  const rows = ziplines.map(zip => `
    <tr>
      <td>${sanitize(zip.zipline_name)}</td>
      <td>${sanitize(zip.cable_type || '')}</td>
      <td>${zip.cable_length || 'N/A'}</td>
      <td>${zip.load_tension || 'N/A'}</td>
      <td>${zip.unload_tension || 'N/A'}</td>
      <td>${sanitize(zip.cable_result || '')}</td>
      <td>${sanitize(zip.braking_system || '')}</td>
      <td>${sanitize(zip.braking_result || '')}</td>
      <td>${sanitize(zip.ead_system || '')}</td>
      <td>${sanitize(zip.ead_result || '')}</td>
      <td>${sanitize(zip.result)}</td>
      <td>${sanitize(zip.comments || '')}</td>
    </tr>
  `).join('');

  return `
    <div class="page page-break">
      <div class="header">
        <div class="header-left">
          <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
        </div>
        <div class="header-center">
          <h1>ROPES/CHALLENGE COURSE</h1>
        </div>
        <div class="header-right">
          <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
        </div>
      </div>

      <h2>Ziplines</h2>

      <table style="font-size: 8pt;">
        <thead>
          <tr>
            <th>Name</th>
            <th>Cable Type</th>
            <th>Length</th>
            <th>Load</th>
            <th>Unload</th>
            <th>Cable Result</th>
            <th>Brake System</th>
            <th>Brake Result</th>
            <th>EAD System</th>
            <th>EAD Result</th>
            <th>Result</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function generateEquipmentPage(equipment: any[], acctLogo: string, ropeWorksLogo: string): string {
  const categories = [...new Set(equipment.map(e => e.equipment_category))];
  
  const sections = categories.map(category => {
    const items = equipment.filter(e => e.equipment_category === category);
    const rows = items.map(item => `
      <tr>
        <td>${sanitize(item.equipment_type)}</td>
        <td>${item.quantity || 'N/A'}</td>
        <td>${item.production_year || 'N/A'}</td>
        <td>${sanitize(item.result)}</td>
        <td>${sanitize(item.comments || '')}</td>
      </tr>
    `).join('');

    return `
      <div class="equipment-section">
        <h3>${sanitize(category)}</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 30%">Type</th>
              <th style="width: 10%">Quantity</th>
              <th style="width: 15%">Year</th>
              <th style="width: 15%">Result</th>
              <th style="width: 30%">Comments</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }).join('');

  return `
    <div class="page page-break">
      <div class="header">
        <div class="header-left">
          <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
        </div>
        <div class="header-center">
          <h1>ROPES/CHALLENGE COURSE</h1>
        </div>
        <div class="header-right">
          <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
        </div>
      </div>

      <h2>Equipment</h2>
      ${sections}
    </div>
  `;
}

function generateStandardsPage(standards: any[], acctLogo: string, ropeWorksLogo: string): string {
  if (!standards || standards.length === 0) {
    return `
      <div class="page page-break">
        <div class="header">
          <div class="header-left">
            <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
          </div>
          <div class="header-center">
            <h1>ROPES/CHALLENGE COURSE</h1>
          </div>
          <div class="header-right">
            <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
          </div>
        </div>
        <h2>ACCT Standards</h2>
        <p>No standards recorded for this inspection.</p>
      </div>
    `;
  }

  const rows = standards.map(std => `
    <tr>
      <td>${sanitize(std.standard_name)}</td>
      <td style="text-align: center;">${std.has_documentation ? '✓' : '✗'}</td>
      <td>${sanitize(std.comments || '')}</td>
    </tr>
  `).join('');

  return `
    <div class="page page-break">
      <div class="header">
        <div class="header-left">
          <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
        </div>
        <div class="header-center">
          <h1>ROPES/CHALLENGE COURSE</h1>
        </div>
        <div class="header-right">
          <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
        </div>
      </div>

      <h2>ACCT Standards</h2>

      <table>
        <thead>
          <tr>
            <th style="width: 40%">Standard Name</th>
            <th style="width: 20%">Documentation</th>
            <th style="width: 40%">Comments</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function generateSummaryPage(summary: any, inspection: any, acctLogo: string, ropeWorksLogo: string): string {
  return `
    <div class="page page-break">
      <div class="header">
        <div class="header-left">
          <img src="data:image/png;base64,${acctLogo}" alt="ACCT">
        </div>
        <div class="header-center">
          <h1>ROPES/CHALLENGE COURSE</h1>
        </div>
        <div class="header-right">
          <img src="data:image/png;base64,${ropeWorksLogo}" alt="Rope Works">
        </div>
      </div>

      <h2>Summary</h2>

      <div class="section-heading">Repairs Performed</div>
      <div style="border: 1px solid #999; padding: 8px; margin-bottom: 15px; min-height: 60px; font-size: 9pt;">
        ${sanitize(summary?.repairs_performed || '')}
      </div>

      <div class="section-heading">Critical Actions</div>
      <div style="border: 1px solid #999; padding: 8px; margin-bottom: 15px; min-height: 60px; font-size: 9pt;">
        ${sanitize(summary?.critical_actions || '')}
      </</div>

      <div class="section-heading">Future Considerations</div>
      <div style="border: 1px solid #999; padding: 8px; margin-bottom: 15px; min-height: 60px; font-size: 9pt;">
        ${sanitize(summary?.future_considerations || '')}
      </div>

      <div class="form-field" style="margin-top: 20px;">
        <label>Next Inspection Date:</label>
        <div class="value">${summary?.next_inspection_date ? formatDate(summary.next_inspection_date) : 'Not specified'}</div>
      </div>

      <h3 style="margin-top: 25px;">General Rope Works Inspection Retirement Guidelines</h3>
      
      <table>
        <thead>
          <tr>
            <th style="width: 40%">Item</th>
            <th style="width: 60%">Retirement Criteria</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Rope</td>
            <td>Any sign of heat damage, chemical damage, glazing, discoloration, core damage, or excessive wear</td>
          </tr>
          <tr>
            <td>Webbing/Slings</td>
            <td>Cuts, tears, abrasions, heat damage, chemical damage, or excessive wear</td>
          </tr>
          <tr>
            <td>Carabiners</td>
            <td>Gate binding, excessive wear, deep grooves, cracks, distortion, or corrosion</td>
          </tr>
          <tr>
            <td>Harnesses</td>
            <td>Cuts, burns, excessive wear, loose stitching, or damaged hardware</td>
          </tr>
          <tr>
            <td>Helmets</td>
            <td>Cracks, dents, UV damage, or damage from impact</td>
          </tr>
          <tr>
            <td>Belay Devices</td>
            <td>Excessive wear, cracks, deformation, or impaired function</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function sanitize(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

function formatDate(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}
